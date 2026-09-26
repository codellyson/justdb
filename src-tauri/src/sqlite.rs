//! SQLite/libsql backend. Same surface as `postgres::PgConnection` for the
//! subset of operations slice 1 needs: open, query → JSON rows, list
//! tables, describe table, browse table rows, run arbitrary SQL.
//!
//! Local files and Turso/sqld endpoints use libsql. Cloudflare D1 uses its
//! REST API, with the same SQLite catalog and query methods above the transport.

use libsql::{params, Builder, Connection, Database, Value as LibsqlValue};
use serde::Serialize;
use serde_json::{Map as JsonMap, Number as JsonNumber, Value as JsonValue};
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::d1::D1Connection;
use crate::postgres::{json_to_text, pg_quote_literal, ColumnMeta, DbConfig, QueryResult};

/// Catalog answer for SQLite's single-schema model. We expose `main` (and
/// `temp` when present) the same way Postgres exposes `public` so the
/// frontend schema picker keeps working without conditionals.
pub const DEFAULT_SCHEMA: &str = "main";

pub struct SqliteConnection {
    backend: SqliteBackend,
}

enum SqliteBackend {
    D1(D1Connection),
    Libsql {
        // libsql::Connection isn't Sync; the Mutex permits shared sessions.
        conn: Mutex<Connection>,
        // Keep the database and its remote background tasks alive.
        db: Arc<Database>,
    },
}

impl SqliteConnection {
    pub async fn connect(config: DbConfig) -> Result<Self, String> {
        let filepath = config
            .filepath
            .as_deref()
            .ok_or_else(|| "SQLite config requires a filepath or libsql:// URL".to_string())?;

        if filepath.starts_with("d1://") {
            let token = config.auth_token.as_deref().unwrap_or_default();
            return Ok(Self {
                backend: SqliteBackend::D1(D1Connection::connect(filepath, token).await?),
            });
        }

        let is_remote = filepath.starts_with("libsql://")
            || filepath.starts_with("https://")
            || filepath.starts_with("http://");

        let token_len = config.auth_token.as_ref().map_or(0, |t| t.len());
        log::info!(
            "[sqlite::connect] start filepath={} remote={} token_len={}",
            filepath,
            is_remote,
            token_len,
        );

        let db = if is_remote {
            let token = config.auth_token.clone().unwrap_or_default();
            if token.is_empty() {
                return Err(
                    "Turso/libsql URLs need an auth token. Append ?authToken=… \
                     to the URL, or paste the token into the Auth token field."
                        .into(),
                );
            }
            log::info!("[sqlite::connect] Builder::new_remote.build() starting…");
            // libsql 0.6's remote builder does an HTTPS health-check during
            // build(), which can wedge on TLS/DNS issues. Wrap in a tokio
            // timeout so the connect call surfaces a clean error to the
            // frontend instead of hanging forever.
            let built = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                Builder::new_remote(filepath.to_string(), token).build(),
            )
            .await
            .map_err(|_| "libsql remote build timed out after 10s".to_string())?
            .map_err(|e| format!("libsql remote build: {e}"))?;
            log::info!("[sqlite::connect] Builder::new_remote.build() done");
            built
        } else {
            let flags = if config.read_only {
                libsql::OpenFlags::SQLITE_OPEN_READ_ONLY
            } else {
                libsql::OpenFlags::default()
            };
            Builder::new_local(filepath)
                .flags(flags)
                .build()
                .await
                .map_err(|e| format!("libsql local build: {e}"))?
        };

        log::info!("[sqlite::connect] db.connect() starting…");
        let conn = db
            .connect()
            .map_err(|e| format!("libsql connect: {e}"))?;
        log::info!("[sqlite::connect] db.connect() done — pinging…");

        // Round-trip ping so connection errors surface here instead of on
        // the first query. Same 20s ceiling — covers Turso auth + first
        // network roundtrip without blocking the user indefinitely on a
        // wrong token / wrong region.
        tokio::time::timeout(
            std::time::Duration::from_secs(10),
            conn.query("SELECT 1", ()),
        )
        .await
        .map_err(|_| {
            "libsql ping timed out after 10s — the URL resolved and TLS \
             completed but SELECT 1 never came back. Most likely cause: \
             auth token is wrong, expired, or missing on a saved \
             connection. Delete + re-add with a fresh token from \
             `turso db tokens create <db>`.".to_string()
        })?
        .map_err(|e| format!("libsql ping: {e}"))?;

        log::info!("[sqlite::connect] ping ok — session ready");

        Ok(Self {
            backend: SqliteBackend::Libsql {
                conn: Mutex::new(conn),
                db: Arc::new(db),
            },
        })
    }

    /// Run an arbitrary SQL query and return rows as JSON objects keyed by
    /// column name — same shape `PgConnection::query_objects` returns, so
    /// downstream serialization paths in `lib.rs` don't need a special
    /// case.
    pub async fn query_objects(&self, sql: &str) -> Result<Vec<JsonValue>, String> {
        let result = self.query(sql).await?;
        Ok(rows_as_objects(&result))
    }

    /// Like `query_objects`, but runs on a freshly checked-out connection from
    /// the same database rather than the shared `conn` Mutex. Used by AI mode
    /// so the agent's exploratory reads never serialize behind — or starve —
    /// the app's own queries or the health ping. Checking out a connection from
    /// an already-open `libsql::Database` is cheap (no file/network re-open).
    pub async fn query_objects_isolated(&self, sql: &str) -> Result<Vec<JsonValue>, String> {
        let result = match &self.backend {
            SqliteBackend::D1(d1) => d1.query(sql).await?,
            SqliteBackend::Libsql { db, .. } => {
                let conn = db.connect().map_err(|e| format!("libsql connect: {e}"))?;
                Self::run_query_on(&conn, sql).await?
            }
        };
        Ok(rows_as_objects(&result))
    }

    /// Run a query and capture column metadata + rows as JSON values. Mirrors
    /// the shape of `postgres::QueryResult`.
    pub async fn query(&self, sql: &str) -> Result<QueryResult, String> {
        match &self.backend {
            SqliteBackend::D1(d1) => d1.query(sql).await,
            SqliteBackend::Libsql { conn, .. } => {
                let conn = conn.lock().await;
                Self::run_query_on(&conn, sql).await
            }
        }
    }

    /// Connection-agnostic query body, so the shared `conn` and a checked-out
    /// isolated connection share one implementation.
    async fn run_query_on(conn: &Connection, sql: &str) -> Result<QueryResult, String> {
        let mut rows = conn
            .query(sql, ())
            .await
            .map_err(|e| format!("libsql query: {e}"))?;

        let n_cols = rows.column_count() as usize;
        let columns: Vec<ColumnMeta> = (0..n_cols)
            .map(|i| ColumnMeta {
                name: rows.column_name(i as i32).unwrap_or("?").to_string(),
                data_type: rows
                    .column_type(i as i32)
                    .map(libsql_type_to_str)
                    .unwrap_or("text")
                    .to_string(),
                table_oid: None,
                column_id: None,
                data_type_id: None,
            })
            .collect();

        let mut serialized: Vec<Vec<JsonValue>> = Vec::new();
        while let Some(row) = rows
            .next()
            .await
            .map_err(|e| format!("libsql row: {e}"))?
        {
            let mut cells = Vec::with_capacity(n_cols);
            for i in 0..n_cols {
                let v = row
                    .get_value(i as i32)
                    .map_err(|e| format!("libsql cell {i}: {e}"))?;
                cells.push(libsql_value_to_json(v));
            }
            serialized.push(cells);
        }

        Ok(QueryResult {
            row_count: serialized.len(),
            columns,
            rows: serialized,
        })
    }

    /// Cheap liveness probe used by `db_health`. Bounded so a wedged
    /// remote libsql connection doesn't hang the entire 30s health-poll
    /// interval — the health hook would never see a fresh tick.
    pub async fn ping(&self) -> bool {
        match &self.backend {
            SqliteBackend::D1(d1) => d1.query("SELECT 1").await.is_ok(),
            SqliteBackend::Libsql { conn, .. } => {
                let conn = conn.lock().await;
                matches!(
                    tokio::time::timeout(
                        std::time::Duration::from_secs(5),
                        conn.query("SELECT 1", ()),
                    )
                    .await,
                    Ok(Ok(_))
                )
            }
        }
    }

    /// `db_list_schemas` for SQLite — always exactly the schemas SQLite
    /// considers reachable (`main`, plus `temp` when in use). No
    /// user-defined schemas in SQLite's model.
    pub async fn list_schemas(&self) -> Result<Vec<String>, String> {
        Ok(vec![DEFAULT_SCHEMA.to_string()])
    }

    /// `db_list_tables` — sqlite_master is the canonical catalog.
    pub async fn list_tables(&self) -> Result<Vec<String>, String> {
        let result = self
            .query(
                "SELECT name FROM sqlite_master \
                 WHERE type = 'table' AND name NOT LIKE 'sqlite_%' \
                 ORDER BY name",
            )
            .await?;
        Ok(first_column_strings(&result.rows))
    }

    /// `db_table_schema` — Postgres returns information_schema rows; for
    /// SQLite we synthesize the same shape from `PRAGMA table_info` so the
    /// frontend's `tableSchema` map function works unchanged.
    pub async fn table_schema(&self, table: &str) -> Result<Vec<JsonValue>, String> {
        validate_identifier(table)?;
        let sql = format!("PRAGMA table_info(\"{table}\")");
        let result = self.query(&sql).await?;
        // PRAGMA columns: cid, name, type, notnull, dflt_value, pk
        let out: Vec<JsonValue> = result
            .rows
            .iter()
            .map(|row| {
                let mut obj = JsonMap::with_capacity(5);
                obj.insert(
                    "column_name".into(),
                    row.get(1).cloned().unwrap_or(JsonValue::Null),
                );
                obj.insert(
                    "data_type".into(),
                    row.get(2).cloned().unwrap_or(JsonValue::Null),
                );
                let notnull = row.get(3).and_then(|v| v.as_i64()).unwrap_or(0);
                obj.insert(
                    "is_nullable".into(),
                    JsonValue::String(if notnull == 0 { "YES" } else { "NO" }.into()),
                );
                obj.insert(
                    "column_default".into(),
                    row.get(4).cloned().unwrap_or(JsonValue::Null),
                );
                let pk = row.get(5).and_then(|v| v.as_i64()).unwrap_or(0);
                obj.insert("is_primary_key".into(), JsonValue::Bool(pk > 0));
                JsonValue::Object(obj)
            })
            .collect();
        Ok(out)
    }

    /// `db_table_rows` with sort, pagination, and filters. Filters are
    /// inlined as escaped SQL literals (mirroring `mutation.rs`'s INSERT
    /// approach) rather than bound parameters — libsql's parameter binding
    /// has stricter type rules than tokio-postgres's text mode.
    pub async fn table_rows(
        &self,
        table: &str,
        limit: u32,
        offset: u32,
        sort_column: Option<&str>,
        sort_direction: Option<&str>,
        filters: &[crate::FilterSpec],
    ) -> Result<TableRowsResponse, String> {
        validate_identifier(table)?;
        let q_table = format!("\"{table}\"");
        let where_sql = build_filter_where_inline(filters)?;

        let total_sql = format!("SELECT COUNT(*) FROM {q_table}{where_sql}");
        let total_res = self.query(&total_sql).await?;
        let total: i64 = total_res
            .rows
            .first()
            .and_then(|r| r.first())
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        let mut data_sql = format!("SELECT * FROM {q_table}{where_sql}");
        if let (Some(col), Some(dir)) = (sort_column, sort_direction) {
            validate_identifier(col)?;
            let dir_kw = if dir.eq_ignore_ascii_case("desc") {
                "DESC"
            } else {
                "ASC"
            };
            data_sql.push_str(&format!(" ORDER BY \"{col}\" {dir_kw}"));
        }
        data_sql.push_str(&format!(" LIMIT {limit} OFFSET {offset}"));

        let rows = self.query_objects(&data_sql).await?;
        Ok(TableRowsResponse {
            rows,
            total,
            limit,
            offset,
            count_is_estimate: false,
        })
    }

    /// Run UPDATE/DELETE and return affected-row count. Used by
    /// `db_mutate` (UPDATE/DELETE branch) and `db_ddl`.
    pub async fn execute(&self, sql: &str) -> Result<u64, String> {
        match &self.backend {
            SqliteBackend::D1(d1) => d1.execute(sql).await,
            SqliteBackend::Libsql { conn, .. } => {
                let conn = conn.lock().await;
                conn.execute(sql, ())
                    .await
                    .map_err(|e| format!("libsql execute: {e}"))
            }
        }
    }

    /// Atomic batch — opens a transaction, runs each statement in order,
    /// commits, or rolls back on any error. Used by `db_mutate_batch` and
    /// `db_import`.
    pub async fn run_transaction(&self, statements: &[String]) -> Result<Vec<u64>, String> {
        let conn = match &self.backend {
            SqliteBackend::D1(d1) => return d1.run_transaction(statements).await,
            SqliteBackend::Libsql { conn, .. } => conn.lock().await,
        };
        let tx = conn
            .transaction()
            .await
            .map_err(|e| format!("libsql begin: {e}"))?;
        let mut row_counts = Vec::with_capacity(statements.len());
        for sql in statements {
            match tx.execute(sql, ()).await {
                Ok(n) => row_counts.push(n),
                Err(e) => {
                    // libsql's Transaction::rollback consumes self, so we
                    // can't keep using `tx` after this branch.
                    let _ = tx.rollback().await;
                    return Err(format!("libsql batch step: {e}"));
                }
            }
        }
        tx.commit()
            .await
            .map_err(|e| format!("libsql commit: {e}"))?;
        Ok(row_counts)
    }

    /// `db_relationships` — walk PRAGMA foreign_key_list + PRAGMA
    /// index_list and synthesize the same shape the Postgres path emits
    /// (`{source_column, target_schema, target_table, target_column,
    /// constraint_name}` rows + `{index_name, index_type, is_unique,
    /// is_primary, columns}` rows). Lets the FK navigator arrows in the
    /// data grid + the indexes panel light up for SQLite.
    pub async fn relationships(
        &self,
        table: &str,
    ) -> Result<(Vec<JsonValue>, Vec<JsonValue>), String> {
        validate_identifier(table)?;

        // PRAGMA columns: id, seq, table, from, to, on_update, on_delete, match
        let fk_sql = format!("PRAGMA foreign_key_list(\"{table}\")");
        let fk_res = self.query(&fk_sql).await?;
        let relationships: Vec<JsonValue> = fk_res
            .rows
            .iter()
            .map(|row| {
                let id = row.first().and_then(|v| v.as_i64()).unwrap_or(0);
                let mut obj = JsonMap::new();
                obj.insert(
                    "constraint_name".into(),
                    JsonValue::String(format!("fk_{table}_{id}")),
                );
                obj.insert(
                    "source_column".into(),
                    row.get(3).cloned().unwrap_or(JsonValue::Null),
                );
                obj.insert(
                    "target_schema".into(),
                    JsonValue::String(DEFAULT_SCHEMA.to_string()),
                );
                obj.insert(
                    "target_table".into(),
                    row.get(2).cloned().unwrap_or(JsonValue::Null),
                );
                obj.insert(
                    "target_column".into(),
                    row.get(4).cloned().unwrap_or(JsonValue::Null),
                );
                JsonValue::Object(obj)
            })
            .collect();

        // PRAGMA index_list: seq, name, unique, origin, partial. We then
        // PRAGMA index_info on each to gather columns.
        let idx_sql = format!("PRAGMA index_list(\"{table}\")");
        let idx_res = self.query(&idx_sql).await?;
        let mut indexes: Vec<JsonValue> = Vec::with_capacity(idx_res.rows.len());
        for row in &idx_res.rows {
            let name = row.get(1).and_then(|v| v.as_str()).unwrap_or("");
            let unique = row.get(2).and_then(|v| v.as_i64()).unwrap_or(0) > 0;
            // origin is "pk" for the implicit primary-key index, "u" for
            // a unique constraint, "c" for CREATE INDEX. We expose the
            // pk flag the Postgres path computes from ix.indisprimary.
            let origin = row.get(3).and_then(|v| v.as_str()).unwrap_or("");
            let is_primary = origin == "pk";
            if name.is_empty() {
                continue;
            }
            let info_sql = format!("PRAGMA index_info(\"{name}\")");
            let info_res = self.query(&info_sql).await?;
            let columns: Vec<JsonValue> = info_res
                .rows
                .iter()
                .filter_map(|r| r.get(2).cloned())
                .collect();
            let mut obj = JsonMap::new();
            obj.insert("index_name".into(), JsonValue::String(name.to_string()));
            obj.insert("index_type".into(), JsonValue::String("btree".to_string()));
            obj.insert("is_unique".into(), JsonValue::Bool(unique));
            obj.insert("is_primary".into(), JsonValue::Bool(is_primary));
            obj.insert("columns".into(), JsonValue::Array(columns));
            indexes.push(JsonValue::Object(obj));
        }

        Ok((relationships, indexes))
    }

    /// `db_lookup_row` — exact-match single column lookup for the FK side
    /// panel. Limited to 2 rows so the UI can flag "more than one match".
    pub async fn lookup_row(
        &self,
        table: &str,
        column: &str,
        value: &JsonValue,
    ) -> Result<Vec<JsonValue>, String> {
        validate_identifier(table)?;
        validate_identifier(column)?;
        let literal = match value {
            JsonValue::Null => "NULL".to_string(),
            other => pg_quote_literal(&json_to_text(other)),
        };
        let sql = format!(
            "SELECT * FROM \"{table}\" WHERE \"{column}\" = {literal} LIMIT 2"
        );
        self.query_objects(&sql).await
    }
}

/// Build a WHERE clause for the SQLite filter path. Mirrors
/// `crate::build_filter_where` (Postgres) but inlines string literals
/// rather than emitting `$1`/`$2` placeholders. Returns `""` for an
/// empty filter list so the caller can append directly.
fn build_filter_where_inline(filters: &[crate::FilterSpec]) -> Result<String, String> {
    if filters.is_empty() {
        return Ok(String::new());
    }
    let to_lit = |v: &JsonValue| -> String {
        match v {
            JsonValue::Null => "NULL".to_string(),
            other => pg_quote_literal(&json_to_text(other)),
        }
    };
    let escape_like = |v: &JsonValue| -> String {
        let raw = match v {
            JsonValue::Null => String::new(),
            JsonValue::String(s) => s.clone(),
            other => other.to_string(),
        };
        let mut out = String::with_capacity(raw.len());
        for c in raw.chars() {
            if c == '\\' || c == '%' || c == '_' {
                out.push('\\');
            }
            out.push(c);
        }
        out
    };
    let mut clauses: Vec<String> = Vec::with_capacity(filters.len());
    for f in filters {
        validate_identifier(&f.column)?;
        let col = format!("\"{}\"", f.column);
        match f.operator.as_str() {
            "eq" => clauses.push(format!(
                "{col} = {}",
                to_lit(f.value.as_ref().unwrap_or(&JsonValue::Null))
            )),
            "neq" => clauses.push(format!(
                "{col} <> {}",
                to_lit(f.value.as_ref().unwrap_or(&JsonValue::Null))
            )),
            "contains" => {
                let pat = format!(
                    "%{}%",
                    escape_like(f.value.as_ref().unwrap_or(&JsonValue::Null))
                );
                // SQLite's LIKE is case-insensitive for ASCII by default,
                // which matches the UX users get from Postgres's ILIKE
                // for English columns. ESCAPE '\\' so escape_like's
                // backslash-encoded specials behave.
                clauses.push(format!("{col} LIKE {} ESCAPE '\\'", pg_quote_literal(&pat)));
            }
            "starts_with" => {
                let pat = format!(
                    "{}%",
                    escape_like(f.value.as_ref().unwrap_or(&JsonValue::Null))
                );
                clauses.push(format!("{col} LIKE {} ESCAPE '\\'", pg_quote_literal(&pat)));
            }
            "is_null" => clauses.push(format!("{col} IS NULL")),
            "is_not_null" => clauses.push(format!("{col} IS NOT NULL")),
            "between" => {
                let vs = f.values.as_ref().ok_or("between requires values")?;
                if vs.len() != 2 {
                    return Err("between requires two values".into());
                }
                clauses.push(format!(
                    "{col} BETWEEN {} AND {}",
                    to_lit(&vs[0]),
                    to_lit(&vs[1])
                ));
            }
            "in" => {
                let vs = f.values.as_ref().ok_or("in requires values")?;
                if vs.is_empty() {
                    return Err("in requires at least one value".into());
                }
                let lits: Vec<String> = vs.iter().map(to_lit).collect();
                clauses.push(format!("{col} IN ({})", lits.join(", ")));
            }
            other => return Err(format!("Unknown filter operator: {other}")),
        }
    }
    Ok(format!(" WHERE {}", clauses.join(" AND ")))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableRowsResponse {
    pub rows: Vec<JsonValue>,
    pub total: i64,
    pub limit: u32,
    pub offset: u32,
    pub count_is_estimate: bool,
}

/// Same SQLite identifier rule the postgres module uses for its own
/// quoting: leading alpha/underscore, then alphanumeric/underscore.
/// Keeps the injection surface small for the few identifier interpolations
/// PRAGMA and SELECT lookups need.
fn validate_identifier(name: &str) -> Result<(), String> {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return Err(format!("invalid identifier: {name}")),
    }
    if !chars.all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(format!("invalid identifier: {name}"));
    }
    Ok(())
}

fn libsql_type_to_str(t: libsql::ValueType) -> &'static str {
    use libsql::ValueType::*;
    match t {
        Integer => "integer",
        Real => "real",
        Text => "text",
        Blob => "blob",
        Null => "null",
    }
}

fn libsql_value_to_json(v: LibsqlValue) -> JsonValue {
    match v {
        LibsqlValue::Null => JsonValue::Null,
        LibsqlValue::Integer(n) => JsonValue::Number(JsonNumber::from(n)),
        LibsqlValue::Real(f) => JsonNumber::from_f64(f)
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::Null),
        LibsqlValue::Text(s) => JsonValue::String(s),
        LibsqlValue::Blob(b) => JsonValue::String(format!("\\x{}", hex_lower(&b))),
    }
}

fn hex_lower(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        use std::fmt::Write as _;
        let _ = write!(s, "{:02x}", b);
    }
    s
}

fn rows_as_objects(result: &QueryResult) -> Vec<JsonValue> {
    result
        .rows
        .iter()
        .map(|row| {
            let mut obj = JsonMap::with_capacity(result.columns.len());
            for (i, col) in result.columns.iter().enumerate() {
                obj.insert(
                    col.name.clone(),
                    row.get(i).cloned().unwrap_or(JsonValue::Null),
                );
            }
            JsonValue::Object(obj)
        })
        .collect()
}

fn first_column_strings(rows: &[Vec<JsonValue>]) -> Vec<String> {
    rows.iter()
        .filter_map(|r| r.first().and_then(|v| v.as_str().map(String::from)))
        .collect()
}

// Suppress `params` being imported via macro re-export — we currently use
// `()` for parameterless queries and will wire bound params with slice 2.
#[allow(dead_code)]
const _: () = {
    let _ = std::marker::PhantomData::<fn() -> params::Params>;
};

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn read_only_local_connection_rejects_writes() {
        let dir = std::env::temp_dir().join(format!("justdb-d1-readonly-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("local.sqlite");
        let config = DbConfig {
            db_type: crate::postgres::DbType::Sqlite,
            host: String::new(),
            port: 0,
            database: "local".to_string(),
            username: String::new(),
            password: String::new(),
            ssl: false,
            filepath: Some(path.to_string_lossy().into_owned()),
            auth_token: None,
            read_only: false,
        };

        let writable = SqliteConnection::connect(config.clone()).await.unwrap();
        writable.execute("CREATE TABLE entries (id INTEGER)").await.unwrap();
        drop(writable);

        let readonly = SqliteConnection::connect(DbConfig {
            read_only: true,
            ..config
        })
        .await
        .unwrap();
        assert!(readonly.query("SELECT * FROM entries").await.is_ok());
        assert!(readonly.execute("INSERT INTO entries (id) VALUES (1)").await.is_err());
        drop(readonly);
        std::fs::remove_dir_all(dir).unwrap();
    }
}

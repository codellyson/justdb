mod ai;
mod cascade;
mod d1;
mod discovery;
mod mcp;
mod mutation;
mod postgres;
mod saved_connections;
mod sqlite;

use dashmap::DashMap;
use mutation::MutationRequest;
use postgres::{format_error as format_pg_error, DbConfig, DbType, PgConnection, QueryResult};
use saved_connections::{ClientSavedConnection, SavedConnection};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlite::SqliteConnection;
use std::sync::Arc;
use tauri::{Emitter, Manager, State};

/// One sessioned database connection — Postgres or SQLite/libsql. Stored
/// behind an `Arc` in `AppState.sessions`; commands `match` on the variant
/// to dispatch to the right backend.
enum DbConnection {
    Pg(PgConnection),
    Sqlite(SqliteConnection),
}

impl DbConnection {
    /// Pull the Postgres backend or surface "not yet supported on SQLite"
    /// for the named command. Used by every command that hasn't grown a
    /// SQLite arm yet (mutations, DDL, EXPLAIN, cascade preview, etc.).
    fn require_pg(&self, what: &str) -> CommandResult<&PgConnection> {
        match self {
            DbConnection::Pg(pg) => Ok(pg),
            DbConnection::Sqlite(_) => sqlite_not_supported(what),
        }
    }
}

#[derive(Default)]
struct AppState {
    // session_id -> live backend connection
    sessions: DashMap<String, Arc<DbConnection>>,
    // session_id -> the config that opened it. Retained so the AI "local CLI
    // agent" path can hand it to a spawned `justdb --mcp-serve` subprocess,
    // which reopens a read-only connection to the same database. Holds the
    // password in memory for the session's lifetime — same exposure class as
    // the live connection, which already carries the credentials internally.
    configs: DashMap<String, DbConfig>,
    // Where saved-connection metadata is persisted (the OS keychain holds the
    // secrets). Resolved once at startup from the app config dir.
    config_dir: std::path::PathBuf,
}

/// Uniform "not implemented for SQLite yet" surface so the frontend gets
/// a readable error instead of an opaque panic. Removed as each command
/// gains a SQLite arm.
fn sqlite_not_supported<T>(what: &str) -> CommandResult<T> {
    Err(CommandError::Query(format!(
        "{what} isn't supported on SQLite yet — landing in the next release."
    )))
}

fn require_session(
    state: &AppState,
    session_id: &str,
) -> Result<Arc<DbConnection>, CommandError> {
    state
        .sessions
        .get(session_id)
        .map(|entry| entry.clone())
        .ok_or_else(|| CommandError::NoSession(session_id.to_string()))
}

#[derive(Debug, Serialize, thiserror::Error)]
#[serde(tag = "kind", content = "message")]
enum CommandError {
    #[error("{0}")]
    Connection(String),
    #[error("{0}")]
    Query(String),
    #[error("no session: {0}")]
    NoSession(String),
}

type CommandResult<T> = Result<T, CommandError>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectResponse {
    session_id: String,
    database: String,
    // Echo the backend type back so the frontend can configure schema
    // selection / SQL dialect without relying on whatever was in the form
    // — saved connections in particular never round-trip the type field
    // otherwise.
    db_type: DbType,
}

#[tauri::command]
async fn db_connect(
    config: DbConfig,
    state: State<'_, AppState>,
) -> CommandResult<ConnectResponse> {
    let database = if config.filepath.as_deref().is_some_and(|path| path.starts_with("d1://")) {
        config.database.clone()
    } else if config.db_type == DbType::Sqlite {
        // For SQLite the "database" label shown in the connection-status pill
        // is the file basename (or libsql hostname). Connections saved before
        // this was normalized hold the whole path in `database`, so take the
        // basename regardless of which field it came from — and split on `\`
        // too, or a Windows path comes back whole.
        let raw = if !config.database.is_empty() {
            config.database.as_str()
        } else {
            config.filepath.as_deref().unwrap_or("sqlite")
        };
        let base = raw.rsplit(['/', '\\']).next().unwrap_or(raw);
        let stem = base.rsplit_once('.').map_or(base, |(s, _)| s);
        if stem.is_empty() { "sqlite".to_string() } else { stem.to_string() }
    } else {
        config.database.clone()
    };

    let db_type = config.db_type.clone();
    let retained = config.clone();
    let conn = match config.db_type {
        DbType::Postgresql => {
            let pg = PgConnection::connect(config)
                .await
                .map_err(|e| CommandError::Connection(e.to_string()))?;
            DbConnection::Pg(pg)
        }
        DbType::Sqlite => {
            let sq = SqliteConnection::connect(config)
                .await
                .map_err(CommandError::Connection)?;
            DbConnection::Sqlite(sq)
        }
    };

    let session_id = uuid::Uuid::new_v4().to_string();
    state.sessions.insert(session_id.clone(), Arc::new(conn));
    state.configs.insert(session_id.clone(), retained);

    Ok(ConnectResponse {
        session_id,
        database,
        db_type,
    })
}

#[tauri::command]
async fn db_query(
    session_id: String,
    sql: String,
    state: State<'_, AppState>,
) -> CommandResult<QueryResult> {
    let conn = require_session(&state, &session_id)?;
    match conn.as_ref() {
        DbConnection::Pg(pg) => pg
            .query(&sql)
            .await
            .map_err(|e| CommandError::Query(format_pg_error(&e))),
        DbConnection::Sqlite(sq) => sq.query(&sql).await.map_err(CommandError::Query),
    }
}

#[tauri::command]
async fn db_disconnect(session_id: String, state: State<'_, AppState>) -> CommandResult<()> {
    state.sessions.remove(&session_id);
    state.configs.remove(&session_id);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    healthy: bool,
    latency: Option<u64>,
    active_connections: u32,
    idle_connections: u32,
}

#[tauri::command]
async fn db_health(
    session_id: String,
    state: State<'_, AppState>,
) -> CommandResult<HealthResponse> {
    // Health never returns Err — the SaaS route also returns 200 with
    // `healthy: false` when there's no pool, so the hook just inspects the body.
    let conn = state.sessions.get(&session_id).map(|entry| entry.clone());
    let Some(conn) = conn else {
        return Ok(HealthResponse {
            healthy: false,
            latency: None,
            active_connections: 0,
            idle_connections: 0,
        });
    };

    let start = std::time::Instant::now();
    let ok = match conn.as_ref() {
        DbConnection::Pg(pg) => pg.query("SELECT 1").await.is_ok(),
        DbConnection::Sqlite(sq) => sq.ping().await,
    };
    Ok(if ok {
        HealthResponse {
            healthy: true,
            latency: Some(start.elapsed().as_millis() as u64),
            active_connections: 1,
            idle_connections: 0,
        }
    } else {
        HealthResponse {
            healthy: false,
            latency: None,
            active_connections: 0,
            idle_connections: 0,
        }
    })
}

#[tauri::command]
async fn db_discover_local() -> Vec<discovery::LocalDatabase> {
    discovery::discover_local_databases(std::iter::empty()).await
}

#[tauri::command]
async fn db_discover_sqlite(
    folder: Option<String>,
    app: tauri::AppHandle,
) -> CommandResult<Vec<discovery::LocalSqliteFile>> {
    let roots = if let Some(folder) = folder {
        let path = std::path::PathBuf::from(folder);
        if !path.is_dir() {
            return Err(CommandError::Query("The selected folder is not available.".into()));
        }
        vec![path]
    } else {
        let home = app
            .path()
            .home_dir()
            .map_err(|e| CommandError::Query(e.to_string()))?;
        [
            "Desktop/workfolder/personal-projects",
            "Desktop/workfolder",
            "Desktop",
            "Documents",
            "Downloads",
            "Projects",
            "Developer",
            "dev",
            "code",
            "workfolder",
        ]
        .into_iter()
        .map(|name| home.join(name))
        .collect()
    };
    tauri::async_runtime::spawn_blocking(move || discovery::discover_sqlite_files(roots))
        .await
        .map_err(|e| CommandError::Query(e.to_string()))
}

#[tauri::command]
async fn db_d1_list(account_id: String, api_token: String) -> CommandResult<Vec<d1::D1Database>> {
    d1::list_databases(&account_id, &api_token)
        .await
        .map_err(CommandError::Connection)
}

#[tauri::command]
async fn db_list_schemas(
    session_id: String,
    state: State<'_, AppState>,
) -> CommandResult<Vec<String>> {
    let conn = require_session(&state, &session_id)?;
    match conn.as_ref() {
        DbConnection::Pg(pg) => {
            let res = pg
                .query(
                    "SELECT schema_name
                     FROM information_schema.schemata
                     WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                     ORDER BY schema_name",
                )
                .await
                .map_err(|e| CommandError::Query(format_pg_error(&e)))?;
            Ok(first_column_strings(&res.rows))
        }
        DbConnection::Sqlite(sq) => sq.list_schemas().await.map_err(CommandError::Query),
    }
}

#[tauri::command]
async fn db_list_tables(
    session_id: String,
    schema: String,
    state: State<'_, AppState>,
) -> CommandResult<Vec<String>> {
    let conn = require_session(&state, &session_id)?;
    match conn.as_ref() {
        DbConnection::Pg(pg) => {
            let res = pg
                .query_with_params(
                    "SELECT table_name
                     FROM information_schema.tables
                     WHERE table_schema = $1 AND table_type = 'BASE TABLE'
                     ORDER BY table_name",
                    &[Some(schema)],
                )
                .await
                .map_err(|e| CommandError::Query(format_pg_error(&e)))?;
            Ok(first_column_strings(&res.rows))
        }
        DbConnection::Sqlite(sq) => sq.list_tables().await.map_err(CommandError::Query),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TableRowsResponse {
    rows: Vec<JsonValue>,
    total: i64,
    limit: u32,
    offset: u32,
    count_is_estimate: bool,
}

// Mirror of `Filter` in apps/web/src/lib/filters.ts. Untagged so the
// JSON shape `{column, operator, value?, values?}` deserializes cleanly.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FilterSpec {
    pub(crate) column: String,
    pub(crate) operator: String,
    #[serde(default)]
    pub(crate) value: Option<JsonValue>,
    #[serde(default)]
    pub(crate) values: Option<Vec<JsonValue>>,
}

// Translate a list of filter specs into a parameterized `WHERE …` clause
// plus a flat params vector (text-typed, matching `query_with_params`).
// Returns `("", [])` for empty input. Operators match the TS shim in
// apps/web/src/lib/filters.ts so behaviour stays identical across runtimes.
fn build_filter_where(
    filters: &[FilterSpec],
) -> Result<(String, Vec<Option<String>>), String> {
    if filters.is_empty() {
        return Ok((String::new(), Vec::new()));
    }
    let mut clauses: Vec<String> = Vec::with_capacity(filters.len());
    let mut params: Vec<Option<String>> = Vec::new();
    let mut next_idx = 1usize;
    let mut next_ph = |params: &mut Vec<Option<String>>, val: Option<String>| -> String {
        params.push(val);
        let ph = format!("${next_idx}");
        next_idx += 1;
        ph
    };
    let to_text = |v: &JsonValue| -> Option<String> {
        match v {
            JsonValue::Null => None,
            JsonValue::String(s) => Some(s.clone()),
            other => Some(other.to_string()),
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

    for f in filters {
        let col = postgres::quote_identifier(&f.column)?;
        match f.operator.as_str() {
            "eq" => {
                let ph = next_ph(&mut params, to_text(f.value.as_ref().unwrap_or(&JsonValue::Null)));
                clauses.push(format!("{col} = {ph}"));
            }
            "neq" => {
                let ph = next_ph(&mut params, to_text(f.value.as_ref().unwrap_or(&JsonValue::Null)));
                clauses.push(format!("{col} <> {ph}"));
            }
            "contains" => {
                let pat = format!("%{}%", escape_like(f.value.as_ref().unwrap_or(&JsonValue::Null)));
                let ph = next_ph(&mut params, Some(pat));
                clauses.push(format!("{col} ILIKE {ph}"));
            }
            "starts_with" => {
                let pat = format!("{}%", escape_like(f.value.as_ref().unwrap_or(&JsonValue::Null)));
                let ph = next_ph(&mut params, Some(pat));
                clauses.push(format!("{col} ILIKE {ph}"));
            }
            "is_null" => clauses.push(format!("{col} IS NULL")),
            "is_not_null" => clauses.push(format!("{col} IS NOT NULL")),
            "between" => {
                let vs = f.values.as_ref().ok_or("between requires values")?;
                if vs.len() != 2 {
                    return Err("between requires two values".into());
                }
                let lo = next_ph(&mut params, to_text(&vs[0]));
                let hi = next_ph(&mut params, to_text(&vs[1]));
                clauses.push(format!("{col} BETWEEN {lo} AND {hi}"));
            }
            "in" => {
                let vs = f.values.as_ref().ok_or("in requires values")?;
                if vs.is_empty() {
                    return Err("in requires at least one value".into());
                }
                let phs: Vec<String> = vs
                    .iter()
                    .map(|v| next_ph(&mut params, to_text(v)))
                    .collect();
                clauses.push(format!("{col} IN ({})", phs.join(", ")));
            }
            other => return Err(format!("Unknown filter operator: {other}")),
        }
    }

    Ok((format!("WHERE {}", clauses.join(" AND ")), params))
}

#[tauri::command]
async fn db_table_rows(
    session_id: String,
    table: String,
    schema: String,
    limit: u32,
    offset: u32,
    sort_column: Option<String>,
    sort_direction: Option<String>,
    filters: Option<Vec<FilterSpec>>,
    state: State<'_, AppState>,
) -> CommandResult<TableRowsResponse> {
    let conn = require_session(&state, &session_id)?;
    let pg = match conn.as_ref() {
        DbConnection::Pg(pg) => pg,
        DbConnection::Sqlite(sq) => {
            let filters_ref: &[FilterSpec] = filters.as_deref().unwrap_or(&[]);
            let res = sq
                .table_rows(
                    &table,
                    limit,
                    offset,
                    sort_column.as_deref(),
                    sort_direction.as_deref(),
                    filters_ref,
                )
                .await
                .map_err(CommandError::Query)?;
            return Ok(TableRowsResponse {
                rows: res.rows,
                total: res.total,
                limit: res.limit,
                offset: res.offset,
                count_is_estimate: res.count_is_estimate,
            });
        }
    };

    let q_schema = postgres::quote_identifier(&schema).map_err(CommandError::Query)?;
    let q_table = postgres::quote_identifier(&table).map_err(CommandError::Query)?;
    let qualified = format!("{q_schema}.{q_table}");

    let filters_ref: &[FilterSpec] = filters.as_deref().unwrap_or(&[]);
    let (where_clause, filter_params) =
        build_filter_where(filters_ref).map_err(CommandError::Query)?;
    let has_filters = !where_clause.is_empty();
    let where_sql = if has_filters {
        format!(" {where_clause}")
    } else {
        String::new()
    };

    // Estimate via pg_class.reltuples; fall back to exact COUNT(*) when small.
    // reltuples returns -1 for never-analyzed tables, which fails the >10k
    // threshold and correctly falls through to the COUNT(*) branch.
    // When filters are present the per-table estimate is meaningless, so
    // skip straight to a filtered COUNT(*).
    let (total, count_is_estimate) = if has_filters {
        let c = pg
            .query_with_params(
                &format!("SELECT COUNT(*) AS count FROM {qualified}{where_sql}"),
                &filter_params,
            )
            .await
            .map_err(|e| CommandError::Query(format_pg_error(&e)))?;
        let n: i64 = c
            .rows
            .first()
            .and_then(|r| r.first())
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        (n, false)
    } else {
        let est = pg
            .query_with_params(
                "SELECT reltuples::bigint AS estimate
                 FROM pg_class c
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relname = $1 AND n.nspname = $2",
                &[Some(table.clone()), Some(schema.clone())],
            )
            .await
            .map_err(|e| CommandError::Query(format_pg_error(&e)))?;
        let estimate: i64 = est
            .rows
            .first()
            .and_then(|r| r.first())
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        if estimate > 10_000 {
            (estimate, true)
        } else {
            let c = pg
                .query(&format!("SELECT COUNT(*) AS count FROM {qualified}"))
                .await
                .map_err(|e| CommandError::Query(format_pg_error(&e)))?;
            let n: i64 = c
                .rows
                .first()
                .and_then(|r| r.first())
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            (n, false)
        }
    };

    let mut data_sql = format!("SELECT * FROM {qualified}{where_sql}");
    if let (Some(col), Some(dir)) = (sort_column.as_deref(), sort_direction.as_deref()) {
        let q_col = postgres::quote_identifier(col).map_err(CommandError::Query)?;
        let dir_kw = if dir.eq_ignore_ascii_case("desc") { "DESC" } else { "ASC" };
        data_sql.push_str(&format!(" ORDER BY {q_col} {dir_kw}"));
    }
    data_sql.push_str(&format!(" LIMIT {limit} OFFSET {offset}"));

    let rows = pg
        .query_objects(&data_sql, &filter_params)
        .await
        .map_err(|e| CommandError::Query(format_pg_error(&e)))?;

    Ok(TableRowsResponse {
        rows,
        total,
        limit,
        offset,
        count_is_estimate,
    })
}

const DEFAULT_IMPORT_BATCH_SIZE: usize = 100;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportResponse {
    success: bool,
    inserted_rows: usize,
}

#[tauri::command]
async fn db_import(
    session_id: String,
    schema: String,
    table: String,
    columns: Vec<String>,
    rows: Vec<Vec<JsonValue>>,
    batch_size: Option<usize>,
    state: State<'_, AppState>,
) -> CommandResult<ImportResponse> {
    if columns.is_empty() {
        return Err(CommandError::Query("`columns` must be non-empty".into()));
    }
    if rows.is_empty() {
        return Err(CommandError::Query("No rows to import".into()));
    }
    postgres::quote_identifier(&schema).map_err(CommandError::Query)?;
    postgres::quote_identifier(&table).map_err(CommandError::Query)?;
    for c in &columns {
        postgres::quote_identifier(c).map_err(CommandError::Query)?;
    }

    let batch = batch_size.unwrap_or(DEFAULT_IMPORT_BATCH_SIZE).max(1);
    let conn = require_session(&state, &session_id)?;

    let mut statements: Vec<String> = Vec::with_capacity(rows.len().div_ceil(batch));
    for chunk in rows.chunks(batch) {
        let sql = mutation::build_bulk_insert(&schema, &table, &columns, chunk)
            .map_err(CommandError::Query)?;
        statements.push(sql);
    }

    match conn.as_ref() {
        DbConnection::Pg(pg) => {
            pg.run_transaction(&statements)
                .await
                .map_err(|e| CommandError::Query(format_pg_error(&e)))?;
        }
        DbConnection::Sqlite(sq) => {
            sq.run_transaction(&statements)
                .await
                .map_err(CommandError::Query)?;
        }
    }

    Ok(ImportResponse {
        success: true,
        inserted_rows: rows.len(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExplainResponse {
    plan: JsonValue,
    execution_time: u64,
}

#[tauri::command]
async fn db_explain(
    session_id: String,
    query: String,
    state: State<'_, AppState>,
) -> CommandResult<ExplainResponse> {
    let conn = require_session(&state, &session_id)?;

    // SaaS guard: EXPLAIN is meaningful only on SELECT / WITH queries.
    // Refusing other statements here mirrors app/api/explain/route.ts.
    let trimmed = query.trim().to_uppercase();
    if !trimmed.starts_with("SELECT") && !trimmed.starts_with("WITH") {
        return Err(CommandError::Query(
            "EXPLAIN is only available for SELECT queries".into(),
        ));
    }

    // SQLite path: `EXPLAIN QUERY PLAN` returns a tabular plan, not JSON.
    // Wrap each row as {id, parent, notused, detail} and hand it back as a
    // JSON array so the editor's plan tree handles it.
    if let DbConnection::Sqlite(sq) = conn.as_ref() {
        let sql = format!("EXPLAIN QUERY PLAN {query}");
        let start = std::time::Instant::now();
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            sq.query(&sql),
        )
        .await
        .map_err(|_| CommandError::Query("EXPLAIN timeout exceeded (30s)".into()))?
        .map_err(CommandError::Query)?;
        let execution_time = start.elapsed().as_millis() as u64;
        let plan = JsonValue::Array(
            result
                .rows
                .iter()
                .map(|row| {
                    let mut obj = serde_json::Map::new();
                    for (i, col) in result.columns.iter().enumerate() {
                        obj.insert(
                            col.name.clone(),
                            row.get(i).cloned().unwrap_or(JsonValue::Null),
                        );
                    }
                    JsonValue::Object(obj)
                })
                .collect(),
        );
        return Ok(ExplainResponse {
            plan,
            execution_time,
        });
    }

    let pg = conn.require_pg("db_explain")?;
    let sql = format!("EXPLAIN (FORMAT JSON) {query}");
    let start = std::time::Instant::now();
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        pg.query(&sql),
    )
    .await
    .map_err(|_| CommandError::Query("EXPLAIN timeout exceeded (30s)".into()))?
    .map_err(|e| CommandError::Query(format_pg_error(&e)))?;
    let execution_time = start.elapsed().as_millis() as u64;

    // EXPLAIN (FORMAT JSON) returns exactly one row, one column ("QUERY PLAN")
    // holding the plan as JSONB. Our JSONB handler already decodes it to
    // JsonValue; the SaaS reads it via row["QUERY PLAN"], we get it positionally.
    let plan = result
        .rows
        .first()
        .and_then(|r| r.first())
        .cloned()
        .unwrap_or(JsonValue::Null);

    Ok(ExplainResponse {
        plan,
        execution_time,
    })
}

#[tauri::command]
async fn db_cascade_preview(
    session_id: String,
    deletes: Vec<cascade::CascadeNodeRequest>,
    options: Option<cascade::CascadeOptions>,
    state: State<'_, AppState>,
) -> CommandResult<cascade::CascadeResult> {
    if deletes.is_empty() {
        return Err(CommandError::Query(
            "`deletes` must be a non-empty array".into(),
        ));
    }
    for (i, d) in deletes.iter().enumerate() {
        postgres::quote_identifier(&d.schema).map_err(|e| {
            CommandError::Query(format!("deletes[{i}].schema: {e}"))
        })?;
        postgres::quote_identifier(&d.table).map_err(|e| {
            CommandError::Query(format!("deletes[{i}].table: {e}"))
        })?;
    }

    let conn = require_session(&state, &session_id)?;
    let pg = conn.require_pg("db_cascade_preview")?;
    Ok(cascade::preview(pg, deletes, options).await)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FieldSource {
    schema: String,
    table: String,
    column: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QueryField {
    name: String,
    // node-postgres exposes this as `dataTypeID` (uppercase ID) and the SaaS
    // SQL editor reads `field.dataTypeID` to map OIDs to type names. Override
    // the camelCase auto-rename so we ship the same key.
    #[serde(rename = "dataTypeID")]
    data_type_id: Option<u32>,
    // FK source: which base-table column produced this output column.
    // Resolved from the prepared statement's tableOid + columnId via two
    // pg_catalog lookups so the SQL editor's FK navigator can activate on
    // result rows. None for computed columns (literals, expressions, function
    // results) or when the underlying relation was dropped.
    source: Option<FieldSource>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RunQueryResponse {
    rows: Vec<JsonValue>,
    execution_time: u64,
    fields: Vec<QueryField>,
}

#[tauri::command]
async fn db_run_query(
    session_id: String,
    sql: String,
    state: State<'_, AppState>,
) -> CommandResult<RunQueryResponse> {
    let conn = require_session(&state, &session_id)?;
    let start = std::time::Instant::now();

    // SQLite path: no pg_catalog → no field-source resolution, no OIDs.
    // Frontend tolerates `fields[].source = None` already (the SaaS path
    // could also fail to resolve sources for derived columns).
    if let DbConnection::Sqlite(sq) = conn.as_ref() {
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            sq.query(&sql),
        )
        .await
        .map_err(|_| CommandError::Query("Query timeout exceeded (30s)".into()))?
        .map_err(CommandError::Query)?;
        let execution_time = start.elapsed().as_millis() as u64;
        let fields: Vec<QueryField> = result
            .columns
            .iter()
            .map(|c| QueryField {
                name: c.name.clone(),
                data_type_id: c.data_type_id,
                source: None,
            })
            .collect();
        let rows = result
            .rows
            .iter()
            .map(|row| {
                let mut obj = serde_json::Map::new();
                for (i, col) in result.columns.iter().enumerate() {
                    obj.insert(
                        col.name.clone(),
                        row.get(i).cloned().unwrap_or(JsonValue::Null),
                    );
                }
                JsonValue::Object(obj)
            })
            .collect();
        return Ok(RunQueryResponse {
            rows,
            execution_time,
            fields,
        });
    }

    let pg = conn.require_pg("db_run_query")?;

    // Match the SaaS executeQuery: 30s budget, return rows as objects keyed by
    // column name, plus per-column type OIDs so the editor can pick the right
    // renderer.
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        pg.query(&sql),
    )
    .await
    .map_err(|_| CommandError::Query("Query timeout exceeded (30s)".into()))?
    .map_err(|e| CommandError::Query(format_pg_error(&e)))?;
    let execution_time = start.elapsed().as_millis() as u64;

    // Resolve base-table sources for any result columns that came from a
    // real relation. Mirrors PostgreSQLProvider.resolveFieldSources on the
    // SaaS side. Two best-effort pg_catalog queries; failures just leave
    // source = None for the affected columns.
    let (oid_map, col_map) = resolve_field_sources(pg, &result.columns).await;

    let fields: Vec<QueryField> = result
        .columns
        .iter()
        .map(|c| {
            let source = match (c.table_oid, c.column_id) {
                (Some(t_oid), Some(c_id)) => match (oid_map.get(&t_oid), col_map.get(&(t_oid, c_id))) {
                    (Some((schema, table)), Some(column)) => Some(FieldSource {
                        schema: schema.clone(),
                        table: table.clone(),
                        column: column.clone(),
                    }),
                    _ => None,
                },
                _ => None,
            };
            QueryField {
                name: c.name.clone(),
                data_type_id: c.data_type_id,
                source,
            }
        })
        .collect();

    let rows = postgres::rows_as_objects(&result);
    Ok(RunQueryResponse {
        rows,
        execution_time,
        fields,
    })
}

// Two pg_catalog lookups in parallel: which (schema, table) each table_oid
// belongs to, and which column name each (table_oid, column_id) pair points
// at. OIDs are integers we control, so inlining them in the IN clause is
// safe — no injection surface.
async fn resolve_field_sources(
    conn: &PgConnection,
    columns: &[postgres::ColumnMeta],
) -> (
    std::collections::HashMap<u32, (String, String)>,
    std::collections::HashMap<(u32, i16), String>,
) {
    let mut oid_set: std::collections::HashSet<u32> = std::collections::HashSet::new();
    let mut pairs: Vec<(u32, i16)> = Vec::new();
    for c in columns {
        if let Some(t_oid) = c.table_oid {
            oid_set.insert(t_oid);
            if let Some(c_id) = c.column_id {
                pairs.push((t_oid, c_id));
            }
        }
    }

    let mut oid_map: std::collections::HashMap<u32, (String, String)> =
        std::collections::HashMap::new();
    let mut col_map: std::collections::HashMap<(u32, i16), String> =
        std::collections::HashMap::new();

    if !oid_set.is_empty() {
        let oids_csv = oid_set
            .iter()
            .map(|o| o.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT c.oid::int AS oid, n.nspname AS schema, c.relname AS table
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.oid IN ({oids_csv})"
        );
        if let Ok(res) = conn.query(&sql).await {
            for row in &res.rows {
                let oid = row.first().and_then(|v| v.as_i64()).map(|n| n as u32);
                let schema = row.get(1).and_then(|v| v.as_str()).map(String::from);
                let table = row.get(2).and_then(|v| v.as_str()).map(String::from);
                if let (Some(o), Some(s), Some(t)) = (oid, schema, table) {
                    oid_map.insert(o, (s, t));
                }
            }
        }
    }

    if !pairs.is_empty() {
        let pairs_csv = pairs
            .iter()
            .map(|(t, c)| format!("({t}, {c})"))
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT attrelid::int AS table_id, attnum::int AS col_id, attname AS name
             FROM pg_attribute
             WHERE (attrelid, attnum) IN ({pairs_csv})"
        );
        if let Ok(res) = conn.query(&sql).await {
            for row in &res.rows {
                let t_id = row.first().and_then(|v| v.as_i64()).map(|n| n as u32);
                let c_id = row.get(1).and_then(|v| v.as_i64()).map(|n| n as i16);
                let name = row.get(2).and_then(|v| v.as_str()).map(String::from);
                if let (Some(t), Some(c), Some(n)) = (t_id, c_id, name) {
                    col_map.insert((t, c), n);
                }
            }
        }
    }

    (oid_map, col_map)
}

#[tauri::command]
async fn db_saved_list(state: State<'_, AppState>) -> CommandResult<Vec<ClientSavedConnection>> {
    saved_connections::list_sanitized(&state.config_dir).map_err(CommandError::Query)
}

#[tauri::command]
async fn db_saved_create(
    id: String,
    name: String,
    config: DbConfig,
    state: State<'_, AppState>,
) -> CommandResult<ClientSavedConnection> {
    saved_connections::save(&state.config_dir, id, name, config).map_err(CommandError::Query)
}

#[tauri::command]
async fn db_saved_delete(id: String, state: State<'_, AppState>) -> CommandResult<()> {
    saved_connections::delete(&state.config_dir, &id).map_err(CommandError::Query)
}

#[tauri::command]
async fn db_saved_connect(
    id: String,
    state: State<'_, AppState>,
) -> CommandResult<ConnectResponse> {
    let saved: SavedConnection = saved_connections::get(&state.config_dir, &id)
        .map_err(CommandError::Query)?
        .ok_or_else(|| CommandError::Query(format!("No saved connection with id {id}")))?;

    let database = saved.config.database.clone();
    let db_type = saved.config.db_type.clone();
    let retained = saved.config.clone();
    let conn = match saved.config.db_type {
        DbType::Postgresql => {
            let pg = PgConnection::connect(saved.config)
                .await
                .map_err(|e| CommandError::Connection(e.to_string()))?;
            DbConnection::Pg(pg)
        }
        DbType::Sqlite => {
            let sq = SqliteConnection::connect(saved.config)
                .await
                .map_err(CommandError::Connection)?;
            DbConnection::Sqlite(sq)
        }
    };

    let session_id = uuid::Uuid::new_v4().to_string();
    state.sessions.insert(session_id.clone(), Arc::new(conn));
    state.configs.insert(session_id.clone(), retained);

    // Bump lastUsed timestamp; failures here don't abort the connect.
    saved_connections::mark_used(&state.config_dir, &id);

    Ok(ConnectResponse {
        session_id,
        database,
        db_type,
    })
}

fn first_column_strings(rows: &[Vec<JsonValue>]) -> Vec<String> {
    rows.iter()
        .filter_map(|r| r.first().and_then(|v| v.as_str().map(String::from)))
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MutateResponse {
    success: bool,
    affected_rows: Option<i64>,
    rows: Vec<JsonValue>,
}

#[tauri::command]
async fn db_mutate(
    session_id: String,
    body: MutationRequest,
    state: State<'_, AppState>,
) -> CommandResult<MutateResponse> {
    let conn = require_session(&state, &session_id)?;
    let sql = mutation::build(&body).map_err(CommandError::Query)?;

    // SQLite path: same SQL builder works — `"main"."tablename"` is valid
    // SQLite syntax, and RETURNING * is supported since 3.35 (which both
    // local sqlite and libsql/Turso satisfy).
    if let DbConnection::Sqlite(sq) = conn.as_ref() {
        return match body.kind {
            mutation::MutationKind::INSERT => {
                let rows = sq.query_objects(&sql).await.map_err(CommandError::Query)?;
                Ok(MutateResponse {
                    success: true,
                    affected_rows: Some(rows.len() as i64),
                    rows,
                })
            }
            mutation::MutationKind::UPDATE | mutation::MutationKind::DELETE => {
                let affected = sq.execute(&sql).await.map_err(CommandError::Query)?;
                Ok(MutateResponse {
                    success: true,
                    affected_rows: Some(affected as i64),
                    rows: vec![],
                })
            }
        };
    }

    let pg = conn.require_pg("db_mutate")?;
    match body.kind {
        mutation::MutationKind::INSERT => {
            // INSERT … RETURNING * — use query() so we get the new row back.
            let result = pg
                .query(&sql)
                .await
                .map_err(|e| CommandError::Query(format_pg_error(&e)))?;
            let rows = postgres::rows_as_objects(&result);
            Ok(MutateResponse {
                success: true,
                affected_rows: Some(rows.len() as i64),
                rows,
            })
        }
        mutation::MutationKind::UPDATE | mutation::MutationKind::DELETE => {
            let affected = pg
                .execute(&sql, &[])
                .await
                .map_err(|e| CommandError::Query(format_pg_error(&e)))?;
            Ok(MutateResponse {
                success: true,
                affected_rows: Some(affected as i64),
                rows: vec![],
            })
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MutateBatchResponse {
    success: bool,
    row_counts: Vec<i64>,
}

#[tauri::command]
async fn db_mutate_batch(
    session_id: String,
    changes: Vec<MutationRequest>,
    state: State<'_, AppState>,
) -> CommandResult<MutateBatchResponse> {
    if changes.is_empty() {
        return Err(CommandError::Query(
            "Batch requires a non-empty `changes` array".into(),
        ));
    }

    let conn = require_session(&state, &session_id)?;

    let mut statements: Vec<String> = Vec::with_capacity(changes.len());
    for (i, change) in changes.iter().enumerate() {
        let sql = mutation::build(change)
            .map_err(|e| CommandError::Query(format!("Change at index {i}: {e}")))?;
        statements.push(sql);
    }

    let row_counts = match conn.as_ref() {
        DbConnection::Pg(pg) => pg
            .run_transaction(&statements)
            .await
            .map_err(|e| CommandError::Query(format_pg_error(&e)))?,
        DbConnection::Sqlite(sq) => sq
            .run_transaction(&statements)
            .await
            .map_err(CommandError::Query)?,
    };

    Ok(MutateBatchResponse {
        success: true,
        row_counts: row_counts.into_iter().map(|n| n as i64).collect(),
    })
}

#[derive(Serialize)]
struct LookupResponse {
    rows: Vec<JsonValue>,
}

#[derive(Serialize)]
struct DdlResponse {
    success: bool,
}

#[tauri::command]
async fn db_ddl(
    session_id: String,
    sql: String,
    state: State<'_, AppState>,
) -> CommandResult<DdlResponse> {
    let conn = require_session(&state, &session_id)?;

    // Mirror /api/ddl/route.ts: only CREATE TABLE is permitted. Trim + upper
    // for a cheap keyword check; the spike's table-creation-wizard is the
    // only caller and always produces a CREATE TABLE.
    if !sql.trim().to_uppercase().starts_with("CREATE TABLE") {
        return Err(CommandError::Query(
            "Only CREATE TABLE statements are allowed".into(),
        ));
    }

    match conn.as_ref() {
        DbConnection::Pg(pg) => {
            pg.execute(&sql, &[])
                .await
                .map_err(|e| CommandError::Query(format_pg_error(&e)))?;
        }
        DbConnection::Sqlite(sq) => {
            sq.execute(&sql).await.map_err(CommandError::Query)?;
        }
    }
    Ok(DdlResponse { success: true })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SchemaMapResponse {
    schema_map: std::collections::BTreeMap<String, Vec<String>>,
}

#[tauri::command]
async fn db_schema_map(
    session_id: String,
    schema: String,
    state: State<'_, AppState>,
) -> CommandResult<SchemaMapResponse> {
    let conn = require_session(&state, &session_id)?;

    // SQLite path: walk sqlite_master + PRAGMA table_info to build the
    // same shape Postgres assembles from information_schema. There's only
    // one effective schema (`main`), so the `schema` arg is ignored.
    if let DbConnection::Sqlite(sq) = conn.as_ref() {
        let tables = sq.list_tables().await.map_err(CommandError::Query)?;
        let mut schema_map: std::collections::BTreeMap<String, Vec<String>> =
            std::collections::BTreeMap::new();
        for t in tables {
            let cols = sq.table_schema(&t).await.map_err(CommandError::Query)?;
            let col_names: Vec<String> = cols
                .into_iter()
                .filter_map(|row| {
                    row.get("column_name")
                        .and_then(|v| v.as_str())
                        .map(String::from)
                })
                .collect();
            schema_map.insert(t, col_names);
        }
        return Ok(SchemaMapResponse { schema_map });
    }

    let pg = conn.require_pg("db_schema_map")?;
    // One query for all base-table columns in the schema, ordered for
    // deterministic grouping. Avoids the N+1 pattern in schema-map/route.ts.
    let res = pg
        .query_with_params(
            "SELECT c.table_name, c.column_name
             FROM information_schema.columns c
             JOIN information_schema.tables t
               ON t.table_schema = c.table_schema
              AND t.table_name = c.table_name
             WHERE c.table_schema = $1
               AND t.table_type = 'BASE TABLE'
             ORDER BY c.table_name, c.ordinal_position",
            &[Some(schema)],
        )
        .await
        .map_err(|e| CommandError::Query(format_pg_error(&e)))?;

    let mut schema_map: std::collections::BTreeMap<String, Vec<String>> =
        std::collections::BTreeMap::new();
    for row in &res.rows {
        let table = row.first().and_then(|v| v.as_str()).unwrap_or_default();
        let col = row.get(1).and_then(|v| v.as_str()).unwrap_or_default();
        if table.is_empty() || col.is_empty() {
            continue;
        }
        schema_map
            .entry(table.to_string())
            .or_default()
            .push(col.to_string());
    }
    Ok(SchemaMapResponse { schema_map })
}

// ─── typed schema overview (for AI grounding) ─────────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FkRef {
    table: String,
    column: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SchemaColumnInfo {
    name: String,
    #[serde(rename = "type")]
    data_type: String,
    pk: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    fk: Option<FkRef>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SchemaTableInfo {
    name: String,
    columns: Vec<SchemaColumnInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SchemaOverviewResponse {
    tables: Vec<SchemaTableInfo>,
}

/// Column types + primary/foreign keys for every base table in the schema.
/// Feeds the AI a typed schema so it writes better casts/joins. Postgres path
/// is three set-based queries (no N+1); SQLite walks PRAGMAs per table.
#[tauri::command]
async fn db_schema_overview(
    session_id: String,
    schema: String,
    state: State<'_, AppState>,
) -> CommandResult<SchemaOverviewResponse> {
    use std::collections::{BTreeMap, HashMap, HashSet};

    let conn = require_session(&state, &session_id)?;

    if let DbConnection::Sqlite(sq) = conn.as_ref() {
        let table_names = sq.list_tables().await.map_err(CommandError::Query)?;
        let mut tables = Vec::with_capacity(table_names.len());
        for t in table_names {
            let cols = sq.table_schema(&t).await.map_err(CommandError::Query)?;
            // foreign_key_list: id, seq, table(target), from, to, ...
            let safe = t.replace('"', "\"\"");
            let fk_rows = sq
                .query(&format!("PRAGMA foreign_key_list(\"{safe}\")"))
                .await
                .map_err(CommandError::Query)?;
            let mut fk_map: HashMap<String, FkRef> = HashMap::new();
            for r in &fk_rows.rows {
                let from = r.get(3).and_then(|v| v.as_str()).unwrap_or_default();
                let tgt_t = r.get(2).and_then(|v| v.as_str()).unwrap_or_default();
                let tgt_c = r.get(4).and_then(|v| v.as_str()).unwrap_or_default();
                if !from.is_empty() && !tgt_t.is_empty() {
                    fk_map.insert(
                        from.to_string(),
                        FkRef { table: tgt_t.to_string(), column: tgt_c.to_string() },
                    );
                }
            }
            let columns = cols
                .iter()
                .filter_map(|row| {
                    let name = row.get("column_name").and_then(|v| v.as_str())?.to_string();
                    let data_type = row
                        .get("data_type")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    let pk = row.get("is_primary_key").and_then(|v| v.as_bool()).unwrap_or(false);
                    let fk = fk_map.get(&name).cloned();
                    Some(SchemaColumnInfo { name, data_type, pk, fk })
                })
                .collect();
            tables.push(SchemaTableInfo { name: t, columns });
        }
        return Ok(SchemaOverviewResponse { tables });
    }

    let pg = conn.require_pg("db_schema_overview")?;

    let cols_res = pg
        .query_with_params(
            "SELECT c.table_name, c.column_name, c.data_type
             FROM information_schema.columns c
             JOIN information_schema.tables t
               ON t.table_schema = c.table_schema AND t.table_name = c.table_name
             WHERE c.table_schema = $1 AND t.table_type = 'BASE TABLE'
             ORDER BY c.table_name, c.ordinal_position",
            &[Some(schema.clone())],
        )
        .await
        .map_err(|e| CommandError::Query(format_pg_error(&e)))?;

    let pk_res = pg
        .query_with_params(
            "SELECT kcu.table_name, kcu.column_name
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
             WHERE tc.table_schema = $1 AND tc.constraint_type = 'PRIMARY KEY'",
            &[Some(schema.clone())],
        )
        .await
        .map_err(|e| CommandError::Query(format_pg_error(&e)))?;

    let fk_res = pg
        .query_with_params(
            "SELECT kcu.table_name, kcu.column_name, ccu.table_name, ccu.column_name
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
             JOIN information_schema.constraint_column_usage ccu
               ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
             WHERE tc.table_schema = $1 AND tc.constraint_type = 'FOREIGN KEY'",
            &[Some(schema)],
        )
        .await
        .map_err(|e| CommandError::Query(format_pg_error(&e)))?;

    let mut pk_set: HashSet<(String, String)> = HashSet::new();
    for row in &pk_res.rows {
        let t = row.first().and_then(|v| v.as_str()).unwrap_or_default();
        let c = row.get(1).and_then(|v| v.as_str()).unwrap_or_default();
        if !t.is_empty() && !c.is_empty() {
            pk_set.insert((t.to_string(), c.to_string()));
        }
    }

    let mut fk_map: HashMap<(String, String), FkRef> = HashMap::new();
    for row in &fk_res.rows {
        let st = row.first().and_then(|v| v.as_str()).unwrap_or_default();
        let sc = row.get(1).and_then(|v| v.as_str()).unwrap_or_default();
        let tt = row.get(2).and_then(|v| v.as_str()).unwrap_or_default();
        let tc = row.get(3).and_then(|v| v.as_str()).unwrap_or_default();
        if !st.is_empty() && !sc.is_empty() && !tt.is_empty() {
            fk_map.insert(
                (st.to_string(), sc.to_string()),
                FkRef { table: tt.to_string(), column: tc.to_string() },
            );
        }
    }

    let mut grouped: BTreeMap<String, Vec<SchemaColumnInfo>> = BTreeMap::new();
    for row in &cols_res.rows {
        let t = row.first().and_then(|v| v.as_str()).unwrap_or_default();
        let c = row.get(1).and_then(|v| v.as_str()).unwrap_or_default();
        let ty = row.get(2).and_then(|v| v.as_str()).unwrap_or_default();
        if t.is_empty() || c.is_empty() {
            continue;
        }
        let key = (t.to_string(), c.to_string());
        grouped.entry(t.to_string()).or_default().push(SchemaColumnInfo {
            name: c.to_string(),
            data_type: ty.to_string(),
            pk: pk_set.contains(&key),
            fk: fk_map.get(&key).cloned(),
        });
    }

    let tables = grouped
        .into_iter()
        .map(|(name, columns)| SchemaTableInfo { name, columns })
        .collect();
    Ok(SchemaOverviewResponse { tables })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ViewsResponse {
    views: Vec<String>,
    materialized_views: Vec<String>,
}

#[tauri::command]
async fn db_views(
    session_id: String,
    schema: String,
    state: State<'_, AppState>,
) -> CommandResult<ViewsResponse> {
    let conn = require_session(&state, &session_id)?;

    // SQLite has views (sqlite_master.type = 'view'); no materialized views.
    if let DbConnection::Sqlite(sq) = conn.as_ref() {
        let res = sq
            .query(
                "SELECT name FROM sqlite_master \
                 WHERE type = 'view' AND name NOT LIKE 'sqlite_%' \
                 ORDER BY name",
            )
            .await
            .map_err(CommandError::Query)?;
        return Ok(ViewsResponse {
            views: first_column_strings(&res.rows),
            materialized_views: vec![],
        });
    }

    let pg = conn.require_pg("db_views")?;
    let views_res = pg
        .query_with_params(
            "SELECT table_name FROM information_schema.views
             WHERE table_schema = $1
             ORDER BY table_name",
            &[Some(schema.clone())],
        )
        .await
        .map_err(|e| CommandError::Query(format_pg_error(&e)))?;

    let matviews_res = pg
        .query_with_params(
            "SELECT matviewname AS name FROM pg_matviews
             WHERE schemaname = $1
             ORDER BY matviewname",
            &[Some(schema)],
        )
        .await
        .map_err(|e| CommandError::Query(format_pg_error(&e)))?;

    Ok(ViewsResponse {
        views: first_column_strings(&views_res.rows),
        materialized_views: first_column_strings(&matviews_res.rows),
    })
}

#[derive(Serialize)]
struct FunctionsResponse {
    functions: Vec<JsonValue>,
}

#[tauri::command]
async fn db_functions(
    session_id: String,
    schema: String,
    state: State<'_, AppState>,
) -> CommandResult<FunctionsResponse> {
    let conn = require_session(&state, &session_id)?;

    // SQLite has no stored functions concept — return empty so the
    // sidebar's Functions section renders empty instead of erroring.
    if matches!(conn.as_ref(), DbConnection::Sqlite(_)) {
        return Ok(FunctionsResponse { functions: vec![] });
    }

    let pg = conn.require_pg("db_functions")?;
    let functions = pg
        .query_objects(
            "SELECT
                p.proname AS name,
                pg_get_function_arguments(p.oid) AS arguments,
                t.typname AS return_type,
                l.lanname AS language,
                CASE p.prokind
                  WHEN 'f' THEN 'function'
                  WHEN 'p' THEN 'procedure'
                  WHEN 'a' THEN 'aggregate'
                  WHEN 'w' THEN 'window'
                END AS kind
             FROM pg_proc p
             JOIN pg_namespace n ON p.pronamespace = n.oid
             JOIN pg_type t ON p.prorettype = t.oid
             JOIN pg_language l ON p.prolang = l.oid
             WHERE n.nspname = $1
               AND p.prokind IN ('f', 'p')
             ORDER BY p.proname",
            &[Some(schema)],
        )
        .await
        .map_err(|e| CommandError::Query(format_pg_error(&e)))?;

    Ok(FunctionsResponse { functions })
}

#[derive(Serialize)]
struct TableCountsResponse {
    counts: std::collections::BTreeMap<String, i64>,
}

#[tauri::command]
async fn db_table_counts(
    session_id: String,
    schema: String,
    state: State<'_, AppState>,
) -> CommandResult<TableCountsResponse> {
    let conn = require_session(&state, &session_id)?;

    // SQLite: no reltuples estimate; do an exact COUNT(*) per table. Acceptable
    // because SQLite databases are typically small and the sidebar caches the
    // result for 5 minutes (see dashboard-context's tableCountsQuery staleTime).
    if let DbConnection::Sqlite(sq) = conn.as_ref() {
        let tables = sq.list_tables().await.map_err(CommandError::Query)?;
        let mut counts: std::collections::BTreeMap<String, i64> =
            std::collections::BTreeMap::new();
        for t in tables {
            // Identifier already validated by list_tables → from sqlite_master.
            let sql = format!("SELECT COUNT(*) FROM \"{t}\"");
            if let Ok(res) = sq.query(&sql).await {
                let n = res
                    .rows
                    .first()
                    .and_then(|r| r.first())
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                counts.insert(t, n);
            }
        }
        return Ok(TableCountsResponse { counts });
    }

    let pg = conn.require_pg("db_table_counts")?;
    let res = pg
        .query_with_params(
            "SELECT c.relname AS table_name, c.reltuples::bigint AS estimate
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relkind = 'r' AND n.nspname = $1",
            &[Some(schema)],
        )
        .await
        .map_err(|e| CommandError::Query(format_pg_error(&e)))?;

    let mut counts: std::collections::BTreeMap<String, i64> =
        std::collections::BTreeMap::new();
    for row in &res.rows {
        let name = row.first().and_then(|v| v.as_str()).unwrap_or_default();
        let estimate = row.get(1).and_then(|v| v.as_i64()).unwrap_or(-1);
        // pg_class.reltuples is -1 for tables that have never been ANALYZE'd.
        // Skip those — surfacing "-1" in the sidebar would mislead.
        if name.is_empty() || estimate < 0 {
            continue;
        }
        counts.insert(name.to_string(), estimate);
    }
    Ok(TableCountsResponse { counts })
}

#[derive(Serialize)]
struct TableStatsResponse {
    stats: Option<JsonValue>,
}

#[tauri::command]
async fn db_table_stats(
    session_id: String,
    table: String,
    schema: String,
    state: State<'_, AppState>,
) -> CommandResult<TableStatsResponse> {
    let conn = require_session(&state, &session_id)?;

    // SQLite has no pg_stat_user_tables analog; we return None and let the
    // stats panel render the empty state. (Slice 2 can synthesize from
    // sqlite_stat1 if the user has run ANALYZE.)
    if matches!(conn.as_ref(), DbConnection::Sqlite(_)) {
        return Ok(TableStatsResponse { stats: None });
    }

    let pg = conn.require_pg("db_table_stats")?;
    let rows = pg
        .query_objects(
            "SELECT
                pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
                pg_size_pretty(pg_relation_size(c.oid))       AS table_size,
                pg_size_pretty(pg_indexes_size(c.oid))        AS index_size,
                c.reltuples::bigint                            AS estimated_rows,
                s.seq_scan,
                s.idx_scan,
                s.n_live_tup                                   AS live_rows,
                s.n_dead_tup                                   AS dead_rows,
                s.last_vacuum,
                s.last_autovacuum,
                s.last_analyze,
                s.last_autoanalyze
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
             WHERE c.relname = $1 AND n.nspname = $2",
            &[Some(table), Some(schema)],
        )
        .await
        .map_err(|e| CommandError::Query(format_pg_error(&e)))?;

    Ok(TableStatsResponse {
        stats: rows.into_iter().next(),
    })
}

#[derive(Serialize)]
struct RelationshipsResponse {
    relationships: Vec<JsonValue>,
    indexes: Vec<JsonValue>,
}

#[tauri::command]
async fn db_relationships(
    session_id: String,
    table: String,
    schema: String,
    state: State<'_, AppState>,
) -> CommandResult<RelationshipsResponse> {
    let conn = require_session(&state, &session_id)?;

    if let DbConnection::Sqlite(sq) = conn.as_ref() {
        // SQLite ignores the schema arg (only `main` exists).
        let _ = schema;
        let (relationships, indexes) =
            sq.relationships(&table).await.map_err(CommandError::Query)?;
        return Ok(RelationshipsResponse {
            relationships,
            indexes,
        });
    }

    let pg = conn.require_pg("db_relationships")?;
    // FKs originating from this table — same SQL the SaaS provider's
    // getTableRelationships uses (lib/providers/postgresql.ts).
    let relationships = pg
        .query_objects(
            "SELECT
                tc.constraint_name,
                kcu.column_name AS source_column,
                ccu.table_schema AS target_schema,
                ccu.table_name AS target_table,
                ccu.column_name AS target_column
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
             JOIN information_schema.constraint_column_usage ccu
               ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
             WHERE tc.constraint_type = 'FOREIGN KEY'
               AND tc.table_name = $1
               AND tc.table_schema = $2
             ORDER BY tc.constraint_name",
            &[Some(table.clone()), Some(schema.clone())],
        )
        .await
        .map_err(|e| CommandError::Query(format_pg_error(&e)))?;

    // Indexes — SaaS uses array_agg, but our postgres_value_to_json doesn't
    // yet decode pg arrays. jsonb_agg gives us a jsonb that decodes
    // straight through to JsonValue::Array for the `columns` field.
    let indexes = pg
        .query_objects(
            "SELECT
                i.relname AS index_name,
                am.amname AS index_type,
                ix.indisunique AS is_unique,
                ix.indisprimary AS is_primary,
                jsonb_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) AS columns
             FROM pg_class t
             JOIN pg_index ix ON t.oid = ix.indrelid
             JOIN pg_class i ON i.oid = ix.indexrelid
             JOIN pg_am am ON i.relam = am.oid
             JOIN pg_namespace n ON n.oid = t.relnamespace
             JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
             WHERE t.relname = $1 AND n.nspname = $2
             GROUP BY i.relname, am.amname, ix.indisunique, ix.indisprimary
             ORDER BY i.relname",
            &[Some(table), Some(schema)],
        )
        .await
        .map_err(|e| CommandError::Query(format_pg_error(&e)))?;

    Ok(RelationshipsResponse {
        relationships,
        indexes,
    })
}

#[tauri::command]
async fn db_lookup_row(
    session_id: String,
    schema: String,
    table: String,
    column: String,
    value: JsonValue,
    state: State<'_, AppState>,
) -> CommandResult<LookupResponse> {
    let conn = require_session(&state, &session_id)?;

    if let DbConnection::Sqlite(sq) = conn.as_ref() {
        // SQLite ignores the `schema` arg (only `main` exists). FK panel
        // submits the schema for catalog-level routing, harmless here.
        let _ = schema;
        let rows = sq
            .lookup_row(&table, &column, &value)
            .await
            .map_err(CommandError::Query)?;
        return Ok(LookupResponse { rows });
    }

    let pg = conn.require_pg("db_lookup_row")?;
    let q_schema = postgres::quote_identifier(&schema).map_err(CommandError::Query)?;
    let q_table = postgres::quote_identifier(&table).map_err(CommandError::Query)?;
    let q_column = postgres::quote_identifier(&column).map_err(CommandError::Query)?;

    let literal = match value {
        JsonValue::Null => "NULL".into(),
        ref other => postgres::pg_quote_literal(&postgres::json_to_text(other)),
    };

    let sql = format!(
        "SELECT * FROM {q_schema}.{q_table} WHERE {q_column} = {literal} LIMIT 2"
    );

    let rows = pg
        .query_objects(&sql, &[])
        .await
        .map_err(|e| CommandError::Query(format_pg_error(&e)))?;
    Ok(LookupResponse { rows })
}

#[tauri::command]
async fn db_table_schema(
    session_id: String,
    table: String,
    schema: String,
    state: State<'_, AppState>,
) -> CommandResult<Vec<JsonValue>> {
    let conn = require_session(&state, &session_id)?;

    if let DbConnection::Sqlite(sq) = conn.as_ref() {
        return sq.table_schema(&table).await.map_err(CommandError::Query);
    }

    let pg = conn.require_pg("db_table_schema")?;
    // Same query the SaaS postgresql provider uses (lib/providers/postgresql.ts
    // getTableSchema). Columns + the PK flag in one round-trip.
    pg.query_objects(
        "SELECT
            c.column_name,
            c.data_type,
            c.is_nullable,
            c.column_default,
            CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key
         FROM information_schema.columns c
         LEFT JOIN (
            SELECT ku.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage ku
              ON tc.constraint_name = ku.constraint_name
            WHERE tc.table_name = $1
              AND tc.table_schema = $2
              AND tc.constraint_type = 'PRIMARY KEY'
         ) pk ON c.column_name = pk.column_name
         WHERE c.table_name = $1
           AND c.table_schema = $2
         ORDER BY c.ordinal_position",
        &[Some(table), Some(schema)],
    )
    .await
    .map_err(|e| CommandError::Query(format_pg_error(&e)))
}

// Writes raw bytes to an absolute path the user already picked via the dialog
// plugin's save() prompt. The frontend hands us the resolved path — there's no
// scope check here because the user just confirmed it in the OS save sheet.
// Used by the Export feature to land CSV/JSON/XLSX where the user wants them
// instead of always dumping to ~/Downloads.
#[tauri::command]
async fn save_export_file(path: String, bytes: Vec<u8>) -> CommandResult<()> {
    tokio::fs::write(&path, &bytes)
        .await
        .map_err(|e| CommandError::Query(format!("Failed to write {path}: {e}")))
}

// ─── AI (opt-in natural-language → SQL) ───────────────────────────────────

#[tauri::command]
async fn ai_status() -> CommandResult<ai::AiStatus> {
    ai::status().map_err(CommandError::Query)
}

#[tauri::command]
async fn ai_set_key(
    provider: String,
    api_key: String,
    model: Option<String>,
) -> CommandResult<ai::AiStatus> {
    ai::set_key(provider, api_key, model).map_err(CommandError::Query)
}

#[tauri::command]
async fn ai_clear_key() -> CommandResult<()> {
    ai::clear_key().map_err(CommandError::Query)
}

#[tauri::command]
async fn ai_generate_sql(args: ai::GenerateArgs) -> CommandResult<ai::GenerateResult> {
    ai::generate_sql(args).await.map_err(CommandError::Query)
}

#[tauri::command]
async fn ai_local_agents() -> CommandResult<Vec<ai::LocalAgentInfo>> {
    Ok(ai::local_agents())
}

// Bridges the AI agent's read-only `run_sql` tool to whichever backend the
// session is connected to. Lives here (not in ai.rs) so the ai module stays
// free of DbConnection knowledge.
struct SessionRunner(Arc<DbConnection>);

#[async_trait::async_trait]
impl ai::SqlRunner for SessionRunner {
    async fn run_readonly(&self, sql: &str) -> Result<Vec<JsonValue>, String> {
        match self.0.as_ref() {
            // Postgres pipelines concurrent queries on its single Client, so the
            // agent's reads don't block the app — share it.
            DbConnection::Pg(pg) => pg
                .query_objects(sql, &[])
                .await
                .map_err(|e| format_pg_error(&e)),
            // SQLite serializes on a Mutex, so give the agent its own
            // checked-out connection to avoid starving the app / health ping.
            DbConnection::Sqlite(sq) => sq.query_objects_isolated(sql).await,
        }
    }
}

#[tauri::command]
async fn ai_chat(
    session_id: String,
    messages: Vec<ai::ChatMessage>,
    dialect: String,
    schema: String,
    model: Option<String>,
    window: tauri::Window,
    state: State<'_, AppState>,
) -> CommandResult<ai::ChatResponse> {
    let conn = require_session(&state, &session_id)?;
    // Stream each tool step and each answer-text chunk to the webview as they
    // arrive, so the UI shows live progress and types the reply out. Both the
    // key-based providers and the local CLI agent emit the same events.
    let step_window = window.clone();
    let on_step = move |step: &ai::ChatStep| {
        let _ = step_window.emit("ai-chat-step", step);
    };
    let on_token = move |token: &str| {
        let _ = window.emit("ai-chat-token", token);
    };

    // Local CLI agent path: hand the session's connection config to a spawned
    // `justdb --mcp-serve` subprocess (via env, never on disk) and stream its
    // output back through the same sinks.
    if ai::is_local_agent().map_err(CommandError::Query)? {
        let config = state
            .configs
            .get(&session_id)
            .map(|c| c.clone())
            .ok_or_else(|| CommandError::NoSession(session_id.clone()))?;
        let config_json = serde_json::to_string(&config)
            .map_err(|e| CommandError::Query(format!("serialize connection config: {e}")))?;
        return ai::chat_claude_cli(config_json, messages, dialect, schema, model, &on_step, &on_token)
            .await
            .map_err(CommandError::Query);
    }

    let runner = SessionRunner(conn);
    ai::chat(&runner, messages, dialect, schema, model, &on_step, &on_token)
        .await
        .map_err(CommandError::Query)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Subprocess mode: when a local CLI agent spawns us as its MCP server
    // (`justdb --mcp-serve`), skip the entire Tauri/window stack and just run
    // the stdio JSON-RPC loop, then exit. Must be the first thing in run().
    if std::env::args().any(|a| a == "--mcp-serve") {
        let rt = tokio::runtime::Runtime::new().expect("failed to start Tokio runtime");
        let code = match rt.block_on(mcp::serve_stdio()) {
            Ok(()) => 0,
            Err(e) => {
                eprintln!("justdb --mcp-serve: {e}");
                1
            }
        };
        std::process::exit(code);
    }

    // The Aptabase telemetry plugin (registered below in keyed builds) calls
    // tokio::spawn in its Tauri setup hook to start a background flush loop.
    // Tauri's setup does not run inside a Tokio runtime, so without an ambient
    // one that spawn panics and the app never boots.
    //
    // Stand up one runtime, register it as Tauri's own via async_runtime::set
    // (so Tauri doesn't lazily create a *second* runtime — which would then
    // panic with "cannot start a runtime from within a runtime" under our
    // enter-guard), then enter it and hold both for the whole process. Gated
    // on the same key so dev builds (no plugin) keep Tauri's default runtime.
    let _telemetry_runtime = option_env!("APTABASE_APP_KEY")
        .filter(|k| !k.is_empty())
        .map(|_| {
            let rt = tokio::runtime::Runtime::new().expect("failed to start Tokio runtime");
            tauri::async_runtime::set(rt.handle().clone());
            rt
        });
    let _telemetry_guard = _telemetry_runtime.as_ref().map(|rt| rt.enter());

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // Windows + Linux only. Must be registered first per the plugin's
    // contract — it intercepts second-instance launches before any other
    // plugin runs and forwards the deep-link argv (justdb://...) into the
    // existing process, which raises the main window instead of spawning
    // a duplicate. macOS skips this because LaunchServices already
    // enforces single-instance for bundled apps.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    // Anonymous usage analytics (Aptabase). Wired only when the build was
    // compiled with an app key — release builds via CI set APTABASE_APP_KEY;
    // dev builds carry no telemetry at all. The plugin is inert until the
    // frontend calls trackEvent, which is gated on the user's opt-out
    // setting, so registration alone never sends anything.
    // `option_env!` is Some("") when CI sets the var from a missing secret,
    // so filter empties — otherwise we'd register the plugin with a bad key.
    if let Some(key) = option_env!("APTABASE_APP_KEY").filter(|k| !k.is_empty()) {
        builder = builder.plugin(tauri_plugin_aptabase::Builder::new(key).build());
    }

    builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        // Registers the `justdb://` URL scheme at install time so the
        // marketing site's "Open JustDB" CTA can launch the desktop app.
        // We don't consume the URL payload yet — the OS just brings the
        // window forward when justdb://<anything> is invoked.
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            // Saved-connection metadata lands here (secrets stay in the OS
            // keychain). app_config_dir is per-app and stable across launches.
            let config_dir = app
                .path()
                .app_config_dir()
                .expect("failed to resolve app config dir");
            app.manage(AppState {
                config_dir,
                ..Default::default()
            });

            // Force launch size after creation so macOS frame restoration
            // can't shrink the window below the config size.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_size(tauri::LogicalSize::new(1600.0, 1000.0));
                let _ = window.center();
            }

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_connect,
            db_query,
            db_disconnect,
            db_health,
            db_discover_local,
            db_discover_sqlite,
            db_d1_list,
            db_list_schemas,
            db_list_tables,
            db_table_rows,
            db_table_schema,
            db_mutate,
            db_mutate_batch,
            db_lookup_row,
            db_ddl,
            db_schema_map,
            db_schema_overview,
            db_relationships,
            db_views,
            db_functions,
            db_table_counts,
            db_table_stats,
            db_saved_list,
            db_saved_create,
            db_saved_delete,
            db_saved_connect,
            db_run_query,
            db_cascade_preview,
            db_explain,
            db_import,
            save_export_file,
            ai_status,
            ai_set_key,
            ai_clear_key,
            ai_generate_sql,
            ai_chat,
            ai_local_agents,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

//! Cloudflare D1 REST transport. Remote D1 is a managed database, not the
//! local SQLite file Wrangler creates for development.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use std::time::Duration;

use crate::postgres::{ColumnMeta, QueryResult};

const API_ROOT: &str = "https://api.cloudflare.com/client/v4/accounts";

#[derive(Debug, Serialize, Deserialize)]
pub struct D1Database {
    #[serde(default)]
    pub uuid: String,
    #[serde(default)]
    pub name: String,
}

#[derive(Debug, Deserialize)]
struct ApiError {
    message: String,
}

#[derive(Debug, Deserialize)]
struct ApiResponse<T> {
    success: bool,
    #[serde(default)]
    errors: Vec<ApiError>,
    result: Option<T>,
}

#[derive(Debug, Deserialize)]
struct RawResult {
    #[serde(default = "default_true")]
    success: bool,
    #[serde(default)]
    results: RawRows,
    #[serde(default)]
    meta: RawMeta,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Default, Deserialize)]
struct RawRows {
    #[serde(default)]
    columns: Vec<String>,
    #[serde(default)]
    rows: Vec<Vec<JsonValue>>,
}

#[derive(Debug, Default, Deserialize)]
struct RawMeta {
    #[serde(default)]
    changes: u64,
}

fn account_id_valid(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn api_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Cloudflare HTTP client: {e}"))
}

fn api_error<T>(response: &ApiResponse<T>) -> String {
    response
        .errors
        .iter()
        .map(|error| error.message.as_str())
        .collect::<Vec<_>>()
        .join("; ")
}

pub async fn list_databases(account_id: &str, token: &str) -> Result<Vec<D1Database>, String> {
    if !account_id_valid(account_id) {
        return Err("Cloudflare account ID must be 32 hexadecimal characters".into());
    }
    if token.trim().is_empty() {
        return Err("Cloudflare API token is required".into());
    }
    let client = api_client()?;
    let mut databases = Vec::new();
    for page in 1..=20 {
        let url = format!("{API_ROOT}/{account_id}/d1/database");
        let response = client
            .get(&url)
            .bearer_auth(token)
            .query(&[("page", page), ("per_page", 100)])
            .send()
            .await
            .map_err(|e| format!("Cloudflare D1 list: {e}"))?;
        let status = response.status();
        let body: ApiResponse<Vec<D1Database>> = response
            .json()
            .await
            .map_err(|e| format!("Cloudflare D1 list response: {e}"))?;
        if !status.is_success() || !body.success {
            return Err(format!("Cloudflare D1 list: HTTP {status}: {}", api_error(&body)));
        }
        let page_results = body.result.unwrap_or_default();
        let done = page_results.len() < 100;
        databases.extend(page_results.into_iter().filter_map(|mut database| {
            if database.uuid.is_empty() {
                return None;
            }
            if database.name.is_empty() {
                database.name = database.uuid.clone();
            }
            Some(database)
        }));
        if done {
            break;
        }
    }
    Ok(databases)
}

pub struct D1Connection {
    client: Client,
    endpoint: String,
    token: String,
}

impl D1Connection {
    pub async fn connect(url: &str, token: &str) -> Result<Self, String> {
        let path = url
            .strip_prefix("d1://")
            .ok_or_else(|| "Expected d1://ACCOUNT_ID/DATABASE_ID".to_string())?;
        let (account_id, database_id) = path
            .split_once('/')
            .ok_or_else(|| "Expected d1://ACCOUNT_ID/DATABASE_ID".to_string())?;
        if !account_id_valid(account_id) || uuid::Uuid::parse_str(database_id).is_err() {
            return Err("Enter a valid Cloudflare account ID and D1 database UUID".into());
        }
        if token.trim().is_empty() {
            return Err("Cloudflare API token is required".into());
        }
        let connection = Self {
            client: api_client()?,
            endpoint: format!("{API_ROOT}/{account_id}/d1/database/{database_id}/raw"),
            token: token.to_string(),
        };
        connection.query("SELECT 1").await?;
        Ok(connection)
    }

    async fn raw(&self, body: JsonValue) -> Result<Vec<RawResult>, String> {
        let response = self
            .client
            .post(&self.endpoint)
            .bearer_auth(&self.token)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Cloudflare D1 query: {e}"))?;
        let status = response.status();
        let body: ApiResponse<Vec<RawResult>> = response
            .json()
            .await
            .map_err(|e| format!("Cloudflare D1 response: {e}"))?;
        if !status.is_success() || !body.success {
            return Err(format!("Cloudflare D1 query: HTTP {status}: {}", api_error(&body)));
        }
        let results = body.result.ok_or("Cloudflare D1 returned no result")?;
        if results.iter().any(|result| !result.success) {
            return Err("Cloudflare D1 query failed".into());
        }
        Ok(results)
    }

    pub async fn query(&self, sql: &str) -> Result<QueryResult, String> {
        let results = self.raw(json!({ "sql": sql })).await?;
        let raw = results
            .into_iter()
            .next()
            .ok_or("Cloudflare D1 returned no result")?;
        let columns = raw
            .results
            .columns
            .iter()
            .enumerate()
            .map(|(index, name)| ColumnMeta {
                name: name.clone(),
                data_type: raw
                    .results
                    .rows
                    .iter()
                    .filter_map(|row| row.get(index))
                    .find(|value| !value.is_null())
                    .map(|value| match value {
                        JsonValue::Number(_) => "numeric",
                        JsonValue::Bool(_) => "boolean",
                        _ => "text",
                    })
                    .unwrap_or("text")
                    .to_string(),
                table_oid: None,
                column_id: None,
                data_type_id: None,
            })
            .collect();
        Ok(QueryResult {
            columns,
            row_count: raw.results.rows.len(),
            rows: raw.results.rows,
        })
    }

    pub async fn execute(&self, sql: &str) -> Result<u64, String> {
        let results = self.raw(json!({ "sql": sql })).await?;
        Ok(results.first().map_or(0, |result| result.meta.changes))
    }

    pub async fn run_transaction(&self, statements: &[String]) -> Result<Vec<u64>, String> {
        if statements.is_empty() {
            return Ok(Vec::new());
        }
        let batch: Vec<_> = statements.iter().map(|sql| json!({ "sql": sql })).collect();
        let results = self.raw(json!({ "batch": batch })).await?;
        Ok(results.into_iter().map(|result| result.meta.changes).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_account_ids() {
        assert!(account_id_valid("0123456789abcdef0123456789abcdef"));
        assert!(!account_id_valid("not-an-account-id"));
    }

    #[test]
    fn parses_raw_rows_and_column_names() {
        let response: ApiResponse<Vec<RawResult>> = serde_json::from_value(json!({
            "success": true,
            "result": [{"success": true, "results": {"columns": ["id", "name"], "rows": [[1, "Ada"]]}, "meta": {"changes": 0}}]
        }))
        .unwrap();
        let rows = &response.result.unwrap()[0].results;
        assert_eq!(rows.columns, ["id", "name"]);
        assert_eq!(rows.rows[0], vec![json!(1), json!("Ada")]);
    }
}

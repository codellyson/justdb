// Storage for saved connections.
//
// Secrets (password + Turso auth token) go in the OS keychain — Keychain on
// macOS, Credential Manager on Windows, Secret Service on Linux — one entry
// per connection. Non-secret metadata (host, port, database, username, ssl,
// timestamps) lives in a plaintext JSON file in the app config dir.
//
// This split matters on Windows: Credential Manager caps a single credential
// blob at CRED_MAX_CREDENTIAL_BLOB_SIZE (2560 bytes), and keyring stores it as
// UTF-16, so ~1280 chars. The previous design packed the whole connection list
// into one entry, which overflowed at ~3-4 connections and failed the write.
// One entry per connection keeps each blob to a single short password.

use std::path::{Path, PathBuf};

use keyring::Entry;
use serde::{Deserialize, Serialize};

use crate::postgres::{DbConfig, DbType};

const SERVICE: &str = "com.kreativekorna.justdb";
// Pre-split builds stored every connection (with secrets) as one JSON blob
// under this account. We migrate and delete it on first access.
const LEGACY_ACCOUNT: &str = "saved-connections";
const META_FILE: &str = "saved-connections.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedConnection {
    pub id: String,
    pub name: String,
    pub config: DbConfig,
    #[serde(rename = "createdAt")]
    pub created_at: u64,
    #[serde(rename = "lastUsed", default, skip_serializing_if = "Option::is_none")]
    pub last_used: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct ClientSavedConnection {
    pub id: String,
    pub name: String,
    pub config: ClientConfig,
    #[serde(rename = "createdAt")]
    pub created_at: u64,
    #[serde(rename = "lastUsed", default, skip_serializing_if = "Option::is_none")]
    pub last_used: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct ClientConfig {
    #[serde(rename = "type")]
    pub db_type: DbType,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    // Always blank — secrets never leave the keychain in the GET path.
    pub password: String,
    pub ssl: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filepath: Option<String>,
    #[serde(rename = "readOnly")]
    pub read_only: bool,
}

// What the keychain holds for one connection. Both fields are secret; the rest
// of the config lives unencrypted in the metadata file.
#[derive(Debug, Default, Serialize, Deserialize)]
struct Secret {
    #[serde(default)]
    password: String,
    #[serde(rename = "authToken", default, skip_serializing_if = "Option::is_none")]
    auth_token: Option<String>,
}

fn secret_entry(id: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, &format!("conn:{id}")).map_err(|e| format!("keychain: {e}"))
}

fn store_secret(id: &str, password: String, auth_token: Option<String>) -> Result<(), String> {
    let secret = Secret {
        password,
        auth_token,
    };
    let json = serde_json::to_string(&secret).map_err(|e| format!("serialize secret: {e}"))?;
    secret_entry(id)?
        .set_password(&json)
        .map_err(|e| format!("keychain write: {e}"))
}

fn load_secret(id: &str) -> Secret {
    let Ok(entry) = secret_entry(id) else {
        return Secret::default();
    };
    match entry.get_password() {
        Ok(json) => serde_json::from_str(&json).unwrap_or_default(),
        Err(_) => Secret::default(),
    }
}

fn delete_secret(id: &str) {
    if let Ok(entry) = secret_entry(id) {
        let _ = entry.delete_credential();
    }
}

fn strip_secrets(config: &DbConfig) -> DbConfig {
    DbConfig {
        password: String::new(),
        auth_token: None,
        ..config.clone()
    }
}

fn meta_path(dir: &Path) -> PathBuf {
    dir.join(META_FILE)
}

fn read_meta(dir: &Path) -> Result<Vec<SavedConnection>, String> {
    match std::fs::read_to_string(meta_path(dir)) {
        Ok(s) if s.trim().is_empty() => Ok(vec![]),
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("parse metadata: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(e) => Err(format!("read metadata: {e}")),
    }
}

fn write_meta(dir: &Path, conns: &[SavedConnection]) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("create config dir: {e}"))?;
    let json = serde_json::to_string_pretty(conns).map_err(|e| format!("serialize: {e}"))?;
    // Write to a temp file and rename so a crash mid-write can't truncate the
    // list. rename is atomic on the same volume (POSIX) and replaces on Windows.
    let tmp = meta_path(dir).with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("write metadata: {e}"))?;
    std::fs::rename(&tmp, meta_path(dir)).map_err(|e| format!("commit metadata: {e}"))
}

// Move the pre-split single-blob entry into the per-connection layout. Runs at
// the top of every public op; a no-op (one cheap keychain read) once the legacy
// entry is gone. Idempotent — safe to re-run if it dies before deleting the
// legacy entry, since upserts and secret writes overwrite by id.
fn migrate_legacy(dir: &Path) {
    let Ok(legacy) = Entry::new(SERVICE, LEGACY_ACCOUNT) else {
        return;
    };
    let json = match legacy.get_password() {
        Ok(json) => json,
        Err(_) => return,
    };
    let Ok(old_conns) = serde_json::from_str::<Vec<SavedConnection>>(&json) else {
        return;
    };

    let mut meta = read_meta(dir).unwrap_or_default();
    for c in old_conns {
        if store_secret(&c.id, c.config.password.clone(), c.config.auth_token.clone()).is_err() {
            // Leave the legacy entry in place so we retry next time.
            return;
        }
        let stripped = SavedConnection {
            config: strip_secrets(&c.config),
            ..c
        };
        match meta.iter_mut().find(|e| e.id == stripped.id) {
            Some(existing) => *existing = stripped,
            None => meta.push(stripped),
        }
    }
    if write_meta(dir, &meta).is_ok() {
        let _ = legacy.delete_credential();
    }
}

pub fn list_full(dir: &Path) -> Result<Vec<SavedConnection>, String> {
    migrate_legacy(dir);
    read_meta(dir)
}

pub fn list_sanitized(dir: &Path) -> Result<Vec<ClientSavedConnection>, String> {
    Ok(list_full(dir)?.iter().map(sanitize).collect())
}

pub fn save(
    dir: &Path,
    id: String,
    name: String,
    config: DbConfig,
) -> Result<ClientSavedConnection, String> {
    migrate_legacy(dir);
    store_secret(&id, config.password.clone(), config.auth_token.clone())?;

    let record = SavedConnection {
        id: id.clone(),
        name,
        config: strip_secrets(&config),
        created_at: now_millis(),
        last_used: None,
    };

    let mut conns = read_meta(dir)?;
    // Upsert by id — duplicates would be a UI bug, but writing once is safer.
    if let Some(existing) = conns.iter_mut().find(|c| c.id == id) {
        // Preserve original createdAt on re-save.
        let created_at = existing.created_at;
        *existing = SavedConnection {
            created_at,
            ..record.clone()
        };
    } else {
        conns.push(record.clone());
    }
    write_meta(dir, &conns)?;
    Ok(sanitize(&record))
}

pub fn delete(dir: &Path, id: &str) -> Result<(), String> {
    migrate_legacy(dir);
    let conns = read_meta(dir)?;
    let remaining: Vec<SavedConnection> = conns.into_iter().filter(|c| c.id != id).collect();
    write_meta(dir, &remaining)?;
    delete_secret(id);
    Ok(())
}

// Full record with the secret rehydrated from the keychain — the connect path
// needs the real password/auth token.
pub fn get(dir: &Path, id: &str) -> Result<Option<SavedConnection>, String> {
    migrate_legacy(dir);
    let Some(mut conn) = read_meta(dir)?.into_iter().find(|c| c.id == id) else {
        return Ok(None);
    };
    let secret = load_secret(id);
    conn.config.password = secret.password;
    conn.config.auth_token = secret.auth_token;
    Ok(Some(conn))
}

// Best-effort timestamp bump on connect. Errors don't fail the connect.
pub fn mark_used(dir: &Path, id: &str) {
    let Ok(mut conns) = read_meta(dir) else {
        return;
    };
    let Some(c) = conns.iter_mut().find(|c| c.id == id) else {
        return;
    };
    c.last_used = Some(now_millis());
    let _ = write_meta(dir, &conns);
}

fn sanitize(c: &SavedConnection) -> ClientSavedConnection {
    ClientSavedConnection {
        id: c.id.clone(),
        name: c.name.clone(),
        config: ClientConfig {
            db_type: c.config.db_type.clone(),
            host: c.config.host.clone(),
            port: c.config.port,
            database: c.config.database.clone(),
            username: c.config.username.clone(),
            password: String::new(),
            ssl: c.config.ssl,
            filepath: c.config.filepath.clone(),
            read_only: c.config.read_only,
        },
        created_at: c.created_at,
        last_used: c.last_used,
    }
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("justdb_saved_conn_test_{tag}"));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn conn(id: &str) -> SavedConnection {
        SavedConnection {
            id: id.to_string(),
            name: format!("db {id}"),
            config: DbConfig {
                db_type: crate::postgres::DbType::Postgresql,
                host: "db.example.com".to_string(),
                port: 5432,
                database: "appdb".to_string(),
                username: "postgres".to_string(),
                password: "hunter2".to_string(),
                ssl: true,
                filepath: None,
                auth_token: None,
                read_only: false,
            },
            created_at: 1,
            last_used: None,
        }
    }

    // The bug: Windows Credential Manager capped one blob at ~1280 chars, so
    // the old single-entry list overflowed past ~3 connections. The metadata
    // file has no such ceiling — prove ten round-trip cleanly.
    #[test]
    fn metadata_store_holds_many_connections() {
        let dir = scratch_dir("many");
        let conns: Vec<SavedConnection> = (0..10).map(|i| conn(&format!("c{i}"))).collect();
        write_meta(&dir, &conns).unwrap();

        let read = read_meta(&dir).unwrap();
        assert_eq!(read.len(), 10);
        assert_eq!(read[7].id, "c7");

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn missing_file_reads_as_empty() {
        let dir = scratch_dir("empty");
        assert!(read_meta(&dir).unwrap().is_empty());
    }

    #[test]
    fn strip_secrets_clears_password_and_token() {
        let mut c = conn("x").config;
        c.auth_token = Some("token".to_string());
        let stripped = strip_secrets(&c);
        assert!(stripped.password.is_empty());
        assert!(stripped.auth_token.is_none());
        // Non-secret fields survive.
        assert_eq!(stripped.host, "db.example.com");
        assert_eq!(stripped.username, "postgres");
    }

    #[test]
    fn sqlite_saved_connection_keeps_file_path_for_display() {
        let mut saved = conn("sqlite");
        saved.config.db_type = DbType::Sqlite;
        saved.config.filepath = Some("/tmp/example.db".to_string());
        saved.config.auth_token = Some("secret".to_string());
        saved.config.read_only = true;

        let client = serde_json::to_value(sanitize(&saved)).unwrap();
        assert_eq!(client["config"]["type"], "sqlite");
        assert_eq!(client["config"]["filepath"], "/tmp/example.db");
        assert_eq!(client["config"]["readOnly"], true);
        assert!(client["config"].get("authToken").is_none());
    }
}

use serde::Serialize;
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::task::JoinSet;
use tokio::time::timeout;

const PROBE_TIMEOUT: Duration = Duration::from_millis(350);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDatabase {
    pub host: &'static str,
    pub port: u16,
    pub db_type: &'static str,
}

#[derive(Debug, Serialize)]
pub struct LocalSqliteFile {
    pub path: String,
    pub name: String,
    pub source: &'static str,
    pub project: Option<String>,
}

const SQLITE_HEADER: &[u8; 16] = b"SQLite format 3\0";
const MAX_SCAN_DEPTH: usize = 10;
const MAX_ENTRIES: usize = 40_000;
const MAX_RESULTS: usize = 100;
const MAX_SCAN_TIME: Duration = Duration::from_secs(4);

fn skip_directory(name: &str) -> bool {
    name.starts_with('.')
        || matches!(
            name.to_ascii_lowercase().as_str(),
            "node_modules"
                | "target"
                | "dist"
                | "build"
                | "vendor"
                | "library"
                | "appdata"
                | "applications"
                | "system"
                | "venv"
                | "__pycache__"
        )
}

fn is_sqlite_file(path: &Path) -> bool {
    let candidate = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "db" | "db3" | "sqlite" | "sqlite3" | "s3db"
            )
        });
    if !candidate {
        return false;
    }

    let Ok(mut file) = File::open(path) else {
        return false;
    };
    let mut header = [0_u8; 16];
    file.read_exact(&mut header).is_ok() && &header == SQLITE_HEADER
}

fn add_d1_files(wrangler: &Path, found: &mut Vec<LocalSqliteFile>, seen: &mut HashSet<PathBuf>) {
    let Some(parent) = wrangler.parent() else {
        return;
    };
    let Some(project_name) = parent.file_name().and_then(|name| name.to_str()) else {
        return;
    };
    let project = if parent
        .parent()
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
        == Some("apps")
    {
        parent
            .parent()
            .and_then(Path::parent)
            .and_then(Path::file_name)
            .and_then(|name| name.to_str())
            .map(|app| format!("{app}/{project_name}"))
            .unwrap_or_else(|| project_name.to_string())
    } else {
        project_name.to_string()
    };
    let Ok(versions) = fs::read_dir(wrangler.join("state")) else {
        return;
    };
    for version in versions.flatten() {
        let d1_dir = version.path().join("d1");
        let Ok(objects) = fs::read_dir(d1_dir) else {
            continue;
        };
        for object in objects.flatten() {
            if !object
                .file_name()
                .to_string_lossy()
                .starts_with("miniflare-D1DatabaseObject")
            {
                continue;
            }
            let Ok(files) = fs::read_dir(object.path()) else {
                continue;
            };
            for file in files.flatten() {
                if found.len() >= MAX_RESULTS {
                    return;
                }
                let path = file.path();
                if file.file_name() == "metadata.sqlite"
                    || !is_sqlite_file(&path)
                    || !seen.insert(path.clone())
                {
                    continue;
                }
                if let Some(path_str) = path.to_str() {
                    found.push(LocalSqliteFile {
                        path: path_str.to_string(),
                        name: file.file_name().to_string_lossy().into_owned(),
                        source: "d1-local",
                        project: Some(project.clone()),
                    });
                }
            }
        }
    }
}

pub fn discover_sqlite_files(roots: Vec<PathBuf>) -> Vec<LocalSqliteFile> {
    let mut found = Vec::new();
    let mut seen = HashSet::new();

    // Find Wrangler state first. A broad SQLite scan can otherwise exhaust its
    // time or entry budget before reaching nested project directories.
    let started = Instant::now();
    let mut stack: Vec<(PathBuf, usize)> = roots
        .iter()
        .rev()
        .filter(|root| root.is_dir())
        .map(|root| (root.clone(), 0))
        .collect();
    let mut visited = 0;
    while let Some((directory, depth)) = stack.pop() {
        if visited >= MAX_ENTRIES
            || found.len() >= MAX_RESULTS
            || started.elapsed() >= MAX_SCAN_TIME
        {
            break;
        }
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            visited += 1;
            if visited >= MAX_ENTRIES
                || found.len() >= MAX_RESULTS
                || started.elapsed() >= MAX_SCAN_TIME
            {
                break;
            }
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() || file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            let name = entry.file_name();
            if name == ".wrangler" {
                add_d1_files(&path, &mut found, &mut seen);
            } else if depth < MAX_SCAN_DEPTH && !skip_directory(&name.to_string_lossy()) {
                stack.push((path, depth + 1));
            }
        }
    }

    let started = Instant::now();
    let mut stack: Vec<(PathBuf, usize)> = roots
        .into_iter()
        .rev()
        .filter(|root| root.is_dir())
        .map(|root| (root, 0))
        .collect();
    let mut visited = 0;

    while let Some((directory, depth)) = stack.pop() {
        if visited >= MAX_ENTRIES
            || found.len() >= MAX_RESULTS
            || started.elapsed() >= MAX_SCAN_TIME
        {
            break;
        }
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            visited += 1;
            if visited >= MAX_ENTRIES
                || found.len() >= MAX_RESULTS
                || started.elapsed() >= MAX_SCAN_TIME
            {
                break;
            }
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            // Do not follow symlinks into system folders or other volumes.
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                if depth < MAX_SCAN_DEPTH && !skip_directory(&entry.file_name().to_string_lossy()) {
                    stack.push((path, depth + 1));
                }
            } else if file_type.is_file() && is_sqlite_file(&path) && seen.insert(path.clone()) {
                if let Some(path_str) = path.to_str() {
                    found.push(LocalSqliteFile {
                        path: path_str.to_string(),
                        name: entry.file_name().to_string_lossy().into_owned(),
                        source: "sqlite",
                        project: None,
                    });
                }
            }
        }
    }
    found.sort_by(|a, b| a.path.cmp(&b.path));
    found
}

// PostgreSQL responds to an SSLRequest with exactly S or N before any
// authentication. This distinguishes it from an arbitrary open TCP port and
// does not require credentials or enumerate any database contents.
async fn is_postgres(port: u16) -> bool {
    let probe = async {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).await?;
        stream.write_all(&[0, 0, 0, 8, 4, 210, 22, 47]).await?;
        let mut response = [0; 1];
        stream.read_exact(&mut response).await?;
        Ok::<bool, std::io::Error>(matches!(response[0], b'S' | b'N'))
    };
    matches!(timeout(PROBE_TIMEOUT, probe).await, Ok(Ok(true)))
}

pub async fn discover_local_databases(
    extra_ports: impl IntoIterator<Item = u16>,
) -> Vec<LocalDatabase> {
    let mut ports: Vec<u16> = (5432..=5442)
        .chain(extra_ports)
        .filter(|port| *port != 0)
        .collect();
    ports.sort_unstable();
    ports.dedup();

    let mut probes = JoinSet::new();
    for port in ports {
        probes.spawn(async move { (port, is_postgres(port).await) });
    }

    let mut found = Vec::new();
    while let Some(result) = probes.join_next().await {
        if let Ok((port, true)) = result {
            found.push(LocalDatabase {
                host: "127.0.0.1",
                port,
                db_type: "postgresql",
            });
        }
    }
    found.sort_by_key(|db| db.port);
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    #[test]
    fn sqlite_scan_checks_file_header_and_skips_build_directories() {
        let root = std::env::temp_dir().join(format!("justdb-discovery-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("project/node_modules")).unwrap();
        fs::write(root.join("project/data.db"), SQLITE_HEADER).unwrap();
        fs::write(root.join("project/fake.db"), b"not a sqlite database").unwrap();
        fs::write(root.join("project/node_modules/hidden.db"), SQLITE_HEADER).unwrap();
        let d1_dir = root.join("project/.wrangler/state/v3/d1/miniflare-D1DatabaseObject");
        fs::create_dir_all(&d1_dir).unwrap();
        fs::write(d1_dir.join("local.sqlite"), SQLITE_HEADER).unwrap();
        fs::write(d1_dir.join("metadata.sqlite"), SQLITE_HEADER).unwrap();
        let other_dir = root.join("project/.wrangler/state/v3/d1/miniflare-DurableObject");
        fs::create_dir_all(&other_dir).unwrap();
        fs::write(other_dir.join("other.sqlite"), SQLITE_HEADER).unwrap();

        let files = discover_sqlite_files(vec![root.clone()]);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].name, "local.sqlite");
        assert_eq!(files[0].source, "d1-local");
        assert_eq!(files[0].project.as_deref(), Some("project"));
        assert_eq!(files[1].name, "data.db");
        assert_eq!(files[1].source, "sqlite");

        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn identifies_postgres_handshake_without_authentication() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 8];
            socket.read_exact(&mut request).await.unwrap();
            assert_eq!(request, [0, 0, 0, 8, 4, 210, 22, 47]);
            socket.write_all(b"N").await.unwrap();
        });

        assert!(is_postgres(port).await);
        server.await.unwrap();
    }
}

export interface ParsedConnectionURL {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl?: boolean;
  type: "postgresql" | "mysql" | "sqlite";
  filepath?: string;
  authToken?: string;
}

/**
 * Last path segment, splitting on both separators — a Windows path
 * (`C:\dir\foo.db`) has no `/` to split on, so a `/`-only split returns the
 * whole path and it ends up displayed as the database name.
 */
export function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** Filename without its extension, used as a SQLite connection's display name. */
export function sqliteDisplayName(filepath: string): string {
  return basename(filepath).replace(/\.[^.]+$/, "") || "sqlite";
}

/**
 * One-line summary for a saved connection. SQLite carries synthetic
 * `localhost:0` host/port to satisfy the shared config shape, so the
 * server-style `host:port/database` form is meaningless for it.
 */
export function describeConnection(config: {
  host: string;
  port: number;
  database: string;
  type?: string;
  filepath?: string;
}): string {
  if (config.type === "sqlite") {
    const target = config.filepath || config.database;
    if (/^d1:\/\//i.test(target)) return `Cloudflare D1 · ${config.database}`;
    return /^libsql:\/\//i.test(target) ? target : basename(target);
  }
  return `${config.host}:${config.port}/${config.database}`;
}

export function parseConnectionURL(url: string): ParsedConnectionURL {
  const trimmed = url.trim();

  if (/^sqlite:\/\//i.test(trimmed)) {
    const filepath = trimmed.replace(/^sqlite:\/\//i, "");
    if (!filepath) throw new Error("SQLite file path is required");
    const database = sqliteDisplayName(filepath);
    return {
      host: "localhost",
      port: 0,
      database,
      username: "",
      password: "",
      type: "sqlite",
      filepath,
    };
  }

  if (/^libsql:\/\//i.test(trimmed)) {
    const parsed = new URL(trimmed);
    const host = parsed.hostname;
    if (!host) throw new Error("Host is required in libsql:// URL");
    const database = host.split(".")[0] || host;
    const authToken = parsed.searchParams.get("authToken") || undefined;
    return {
      host,
      port: 0,
      database,
      username: "",
      password: "",
      type: "sqlite",
      filepath: trimmed.split("?")[0],
      authToken,
    };
  }

  const schemeMatch = trimmed.match(/^(postgresql|postgres|mysql):\/\//i);
  if (!schemeMatch) {
    throw new Error(
      "Invalid connection URL. Expected format: postgresql://user:pass@host:port/dbname or sqlite:///path/to/db"
    );
  }

  const parsed = new URL(trimmed);

  const host = parsed.hostname;
  if (!host) throw new Error("Host is required in connection URL");

  const defaultPort = schemeMatch[1].toLowerCase() === "mysql" ? 3306 : 5432;
  const port = parsed.port ? parseInt(parsed.port, 10) : defaultPort;

  const database = parsed.pathname.replace(/^\//, "");
  if (!database) throw new Error("Database name is required in connection URL");

  const username = decodeURIComponent(parsed.username);
  if (!username) throw new Error("Username is required in connection URL");

  const password = decodeURIComponent(parsed.password);

  const sslParam =
    parsed.searchParams.get("sslmode") || parsed.searchParams.get("ssl");
  let ssl: boolean | undefined;
  if (
    sslParam === "require" ||
    sslParam === "true" ||
    sslParam === "verify-full"
  ) {
    ssl = true;
  } else if (sslParam === "disable" || sslParam === "false") {
    ssl = false;
  }

  const type: "postgresql" | "mysql" =
    schemeMatch[1].toLowerCase() === "mysql" ? "mysql" : "postgresql";

  return { host, port, database, username, password, ssl, type };
}

export function isConnectionURL(input: string): boolean {
  return /^(postgresql|postgres|mysql|sqlite|libsql):\/\//i.test(input.trim());
}

export function detectDatabaseType(
  url: string
): "postgresql" | "mysql" | "sqlite" {
  const trimmed = url.trim();
  if (/^(sqlite|libsql):\/\//i.test(trimmed)) return "sqlite";
  if (/^mysql:\/\//i.test(trimmed)) return "mysql";
  return "postgresql";
}

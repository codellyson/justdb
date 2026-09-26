export interface DBConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  // Always a plain boolean — the legacy `pg`-driver object shape
  // (`{ rejectUnauthorized: false }`) silently deserialized as `false`
  // on the Rust side because DbConfig declares `ssl: bool`, which made
  // every "require TLS" cloud Postgres look like a server connection
  // refusal.
  ssl?: boolean;
  type?: "postgresql" | "mysql" | "sqlite";
  /** File path, libsql:// URL, or d1://account/database URL (SQLite dialect). */
  filepath?: string;
  /** Auth token for Turso/libSQL or Cloudflare D1; saved in the OS keychain. */
  authToken?: string;
  /** Open local SQLite without write access (used for local D1 state). */
  readOnly?: boolean;
}

export interface SavedConnection {
  id: string;
  name: string;
  config: DBConfig;
  createdAt: number;
  lastUsed?: number;
}

export interface Column {
  name: string;
  type: string;
  nullable: boolean;
  default?: string;
  isPrimaryKey?: boolean;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default?: string | null;
  isPrimaryKey?: boolean;
}

export interface Index {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface Constraint {
  name: string;
  type: 'primary_key' | 'foreign_key' | 'unique' | 'check';
  columns: string[];
}

export interface QueryHistoryEntry {
  id: string;
  query: string;
  executionTime: number;
  rowCount: number;
  timestamp: number;
  isFavorite: boolean;
}

export interface SavedQuery {
  id: string;
  name: string;
  query: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ColumnDefinition {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  isPrimaryKey: boolean;
  isUnique: boolean;
}

export interface TableDefinition {
  name: string;
  schema: string;
  columns: ColumnDefinition[];
}

export interface PinnedResult {
  id: string;
  query: string;
  columns: string[];
  data: any[];
  executionTime: number;
  pinnedAt: number;
}

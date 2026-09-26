/**
 * Typed Tauri command client.
 *
 * All Rust backend calls go through this module. There is no HTTP layer —
 * each function maps to one `invoke('db_*', ...)` call. Session state lives
 * here because the Rust DashMap is process-scoped: a webview reload drops
 * the session, matching module-memory lifetime.
 *
 * Read/write classification for the SQL editor is done in JS via
 * lib/query-classifier (intentional — classifier-as-safety only matters
 * across a hostile client/server boundary, which doesn't exist when the
 * user owns the binary).
 */

import { invoke as tauriInvoke, type InvokeArgs } from "@tauri-apps/api/core";

import { classifyQuery, requiresTypedConfirmation } from "./query-classifier";
import type { DBConfig, SavedConnection } from "@/types";
import type { Filter } from "./filters";
import type { MutationRequest } from "./mutation";

let sessionId: string | null = null;

export function getSessionId(): string | null {
  return sessionId;
}

// Dev-only debug hook — surface internal connection state to the devtools
// console so we can diagnose "Not connected" mysteries without adding
// throwaway logs. Drop later if/when the debugging stops being useful.
if (typeof window !== 'undefined') {
  (window as unknown as { __justdbDebug: unknown }).__justdbDebug = {
    get sessionId() { return sessionId; },
  };
}

function requireSession(): string {
  if (!sessionId) {
    throw new Error("Not connected. Connect to a database first.");
  }
  return sessionId;
}

function invoke<T>(cmd: string, args?: InvokeArgs): Promise<T> {
  return tauriInvoke<T>(cmd, args);
}

// ─── connection lifecycle ────────────────────────────────────────────────

interface ConnectResult {
  sessionId: string;
  database: string;
  type: string;
  savedConnection?: SavedConnection;
}

// Rust's ConnectResponse — `db_type` is the authoritative backend kind,
// echoed back from the persisted config (saved connections don't keep
// `type` on the JS side, so the form-provided value would be lost otherwise).
interface ConnectInvokeResponse {
  sessionId: string;
  database: string;
  dbType: "postgresql" | "sqlite";
}

async function connect(
  config: DBConfig,
  save?: { name: string; id: string },
): Promise<ConnectResult> {
  // Keep the prior session valid until the new one is established. We
  // used to pre-emptively `await disconnect()` here, which left the JS
  // sessionId = null during the few-hundred-ms while the new connect
  // resolved. Any health-poll or table-data query that fired in that
  // window threw "Not connected" → the dashboard rendered Connection
  // lost / Reconnecting state for a perfectly healthy connection.
  const oldSessionId = sessionId;
  const res = await invoke<ConnectInvokeResponse>("db_connect", { config });
  sessionId = res.sessionId;
  if (oldSessionId && oldSessionId !== res.sessionId) {
    // Best-effort cleanup of the prior session — runs in the background
    // so a slow disconnect doesn't delay the new session being usable.
    invoke<void>("db_disconnect", { sessionId: oldSessionId }).catch(() => {});
  }

  let savedConnection: SavedConnection | undefined;
  if (save) {
    try {
      savedConnection = await invoke<SavedConnection>("db_saved_create", {
        id: save.id,
        name: save.name,
        config,
      });
    } catch (e) {
      // Keychain write failing (e.g. Linux without gnome-keyring) shouldn't
      // fail the connect. User is connected; the connection just isn't saved.
      console.error("[db] saved-connection write failed:", e);
    }
  }

  return {
    sessionId: res.sessionId,
    database: res.database,
    type: res.dbType,
    savedConnection,
  };
}

async function connectSaved(
  id: string,
): Promise<{ sessionId: string; database: string; type: "postgresql" | "sqlite" }> {
  // See `connect` above for why the prior sessionId stays live until the
  // new one resolves.
  const oldSessionId = sessionId;
  const res = await invoke<ConnectInvokeResponse>("db_saved_connect", { id });
  sessionId = res.sessionId;
  if (oldSessionId && oldSessionId !== res.sessionId) {
    invoke<void>("db_disconnect", { sessionId: oldSessionId }).catch(() => {});
  }
  return { sessionId: res.sessionId, database: res.database, type: res.dbType };
}

// Drop a specific session id without touching the module-level current
// sessionId — unless that current id is the one we're dropping, in which
// case clear it too. Used to clean up orphans from cancelled connects
// without disturbing a fresh attempt that already raced ahead.
async function disconnectId(id: string): Promise<void> {
  await invoke<void>("db_disconnect", { sessionId: id }).catch(() => {});
  if (sessionId === id) sessionId = null;
}

async function disconnect(): Promise<void> {
  if (!sessionId) return;
  await invoke<void>("db_disconnect", { sessionId });
  sessionId = null;
}

interface HealthState {
  healthy: boolean;
  latency: number | null;
  activeConnections?: number;
  idleConnections?: number;
}

export interface LocalDatabase {
  host: string;
  port: number;
  dbType: "postgresql";
}

export interface LocalSqliteFile {
  path: string;
  name: string;
  source: 'sqlite' | 'd1-local';
  project?: string;
}

export interface D1Database {
  uuid: string;
  name: string;
}

const discoverLocal = () => invoke<LocalDatabase[]>("db_discover_local");
const discoverSqlite = (folder?: string) =>
  invoke<LocalSqliteFile[]>("db_discover_sqlite", { folder });
const listD1Databases = (accountId: string, apiToken: string) =>
  invoke<D1Database[]>("db_d1_list", { accountId, apiToken });

async function health(): Promise<HealthState> {
  if (!sessionId) {
    return { healthy: false, latency: null, activeConnections: 0, idleConnections: 0 };
  }
  return invoke<HealthState>("db_health", { sessionId });
}

// ─── catalog listings ─────────────────────────────────────────────────────

const listSchemas = () =>
  invoke<string[]>("db_list_schemas", { sessionId: requireSession() });

const listTables = (schema = "public") =>
  invoke<string[]>("db_list_tables", { sessionId: requireSession(), schema });

// The Rust ViewsResponse already shapes the camelCase fields; pass straight.
const listViews = (schema = "public") =>
  invoke<{ views: string[]; materializedViews: string[] }>("db_views", {
    sessionId: requireSession(),
    schema,
  });

// Rust wraps in `{ functions }` — peel for callers.
const listFunctions = async (schema = "public"): Promise<unknown[]> => {
  const res = await invoke<{ functions: unknown[] }>("db_functions", {
    sessionId: requireSession(),
    schema,
  });
  return res.functions ?? [];
};

// Rust wraps in `{ schemaMap }` — peel.
const schemaMap = async (schema = "public"): Promise<Record<string, string[]>> => {
  const res = await invoke<{ schemaMap: Record<string, string[]> }>(
    "db_schema_map",
    { sessionId: requireSession(), schema },
  );
  return res.schemaMap ?? {};
};

// Typed schema overview (column types + PK/FK) for the whole schema — used to
// ground the AI. Rust wraps in `{ tables }` — peel.
const schemaOverview = async (schema = "public"): Promise<SchemaOverviewTable[]> => {
  const res = await invoke<{ tables: SchemaOverviewTable[] }>("db_schema_overview", {
    sessionId: requireSession(),
    schema,
  });
  return res.tables ?? [];
};

// Rust wraps in `{ counts }` — peel.
const tableCounts = async (schema = "public"): Promise<Record<string, number>> => {
  const res = await invoke<{ counts: Record<string, number> }>(
    "db_table_counts",
    { sessionId: requireSession(), schema },
  );
  return res.counts ?? {};
};

// ─── table-level reads ────────────────────────────────────────────────────

interface TableRowsArgs {
  table: string;
  schema?: string;
  limit?: number;
  offset?: number;
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  filters?: Filter[];
}

interface TableRowsResponse {
  rows: any[];
  total: number;
  limit: number;
  offset: number;
  countIsEstimate: boolean;
}

function tableRows(args: TableRowsArgs): Promise<TableRowsResponse> {
  return invoke<TableRowsResponse>("db_table_rows", {
    sessionId: requireSession(),
    schema: args.schema ?? "public",
    limit: args.limit ?? 100,
    offset: args.offset ?? 0,
    table: args.table,
    sortColumn: args.sortColumn,
    sortDirection: args.sortDirection,
    filters: args.filters && args.filters.length > 0 ? args.filters : undefined,
  });
}

const tableSchema = (table: string, schema = "public") =>
  invoke<any[]>("db_table_schema", {
    sessionId: requireSession(),
    table,
    schema,
  });

const relationships = (table: string, schema = "public") =>
  invoke<{ relationships: any[]; indexes: any[] }>("db_relationships", {
    sessionId: requireSession(),
    table,
    schema,
  });

// Rust wraps in `{ stats }` — peel.
const tableStats = async (table: string, schema = "public"): Promise<any> => {
  const res = await invoke<{ stats: any }>("db_table_stats", {
    sessionId: requireSession(),
    table,
    schema,
  });
  return res?.stats ?? null;
};

// ─── mutations / DDL ──────────────────────────────────────────────────────

const mutate = (request: MutationRequest) =>
  invoke<unknown>("db_mutate", { sessionId: requireSession(), body: request });

const mutateBatch = (changes: MutationRequest[]) =>
  invoke<unknown>("db_mutate_batch", {
    sessionId: requireSession(),
    changes,
  });

const ddl = (sql: string) =>
  invoke<unknown>("db_ddl", { sessionId: requireSession(), sql });

const cascadePreview = (deletes: unknown[], options?: unknown) =>
  invoke<any>("db_cascade_preview", {
    sessionId: requireSession(),
    deletes,
    options,
  });

interface LookupRowArgs {
  schema: string;
  table: string;
  column: string;
  value: unknown;
}

const lookupRow = (args: LookupRowArgs) =>
  invoke<{ rows: any[] }>("db_lookup_row", {
    sessionId: requireSession(),
    schema: args.schema,
    table: args.table,
    column: args.column,
    value: args.value ?? null,
  });

interface ImportArgs {
  schema: string;
  table: string;
  columns: string[];
  rows: unknown[][];
  batchSize?: number;
}

const importRows = (args: ImportArgs) =>
  invoke<{ insertedRows: number }>("db_import", {
    sessionId: requireSession(),
    ...args,
  });

const explain = (query: string) =>
  invoke<any>("db_explain", { sessionId: requireSession(), query });

// ─── saved connections (OS keychain) ─────────────────────────────────────

const savedList = () => invoke<SavedConnection[]>("db_saved_list");
const savedCreate = (id: string, name: string, config: DBConfig) =>
  invoke<SavedConnection>("db_saved_create", { id, name, config });
const savedDelete = (id: string) =>
  invoke<void>("db_saved_delete", { id });

// ─── SQL editor (classifier gate stays in JS) ────────────────────────────

interface RunQueryConfirmation {
  needsConfirmation: true;
  preview: string;
  classification: {
    kind: "write" | "ddl";
    statement: string;
    isBulkWrite: boolean;
    requiresTypedConfirmation: boolean;
  };
}

interface RunQueryResult {
  needsConfirmation?: false;
  rows: any[];
  executionTime: number;
  fields: any[];
  classification: {
    kind: string;
    statement: string;
    isBulkWrite: boolean;
  };
}

async function runQuery(
  query: string,
  confirmed = false,
): Promise<RunQueryConfirmation | RunQueryResult> {
  const sid = requireSession();
  const classification = classifyQuery(query);
  if (classification.kind === "blocked" || classification.kind === "unknown") {
    throw new Error(
      classification.reason ||
        `Statements of type ${classification.statement || "(unknown)"} are not allowed`,
    );
  }
  if (
    (classification.kind === "write" || classification.kind === "ddl") &&
    !confirmed
  ) {
    return {
      needsConfirmation: true,
      preview: query,
      classification: {
        kind: classification.kind,
        statement: classification.statement,
        isBulkWrite: classification.isBulkWrite,
        requiresTypedConfirmation: requiresTypedConfirmation(classification),
      },
    };
  }
  const result = await invoke<{
    rows: any[];
    executionTime: number;
    fields: any[];
  }>("db_run_query", { sessionId: sid, sql: query });
  return {
    ...result,
    classification: {
      kind: classification.kind,
      statement: classification.statement,
      isBulkWrite: classification.isBulkWrite,
    },
  };
}

// ─── public API ──────────────────────────────────────────────────────────

export const db = {
  // connection lifecycle
  connect,
  connectSaved,
  disconnect,
  disconnectId,
  health,
  discoverLocal,
  discoverSqlite,
  listD1Databases,
  isConnected: () => sessionId !== null,

  // listings
  listSchemas,
  listTables,
  listViews,
  listFunctions,
  schemaMap,
  schemaOverview,
  tableCounts,

  // table-level
  tableRows,
  tableSchema,
  relationships,
  tableStats,

  // mutations
  mutate,
  mutateBatch,
  ddl,
  cascadePreview,
  lookupRow,
  importRows,
  explain,

  // saved connections
  savedList,
  savedCreate,
  savedDelete,

  // SQL editor
  runQuery,
};

export interface SchemaOverviewColumn {
  name: string;
  type: string;
  pk: boolean;
  fk?: { table: string; column: string };
}
export interface SchemaOverviewTable {
  name: string;
  columns: SchemaOverviewColumn[];
}

export type { TableRowsResponse, ConnectResult, HealthState, RunQueryResult, RunQueryConfirmation };

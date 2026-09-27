import { splitSqlStatements } from './sql-statements';
export type QueryKind = 'read' | 'write' | 'ddl' | 'transaction' | 'unknown';

export interface QueryClassification {
  kind: QueryKind;
  statement: string;
  isBulkWrite: boolean;
  reason?: string;
}

const READ_KEYWORDS = new Set(['SELECT', 'WITH', 'EXPLAIN', 'SHOW', 'PRAGMA', 'DESCRIBE', 'DESC']);
const WRITE_KEYWORDS = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'UPSERT', 'REPLACE']);
const DDL_KEYWORDS = new Set(['CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'RENAME']);
const TRANSACTION_KEYWORDS = new Set(['BEGIN', 'COMMIT', 'END', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'START']);
const ADMIN_KEYWORDS = new Set([
  'GRANT', 'REVOKE', 'CALL', 'EXEC', 'EXECUTE', 'COPY', 'IMPORT', 'LOAD',
  'VACUUM', 'REINDEX', 'CLUSTER', 'REFRESH', 'REASSIGN', 'DO', 'NOTIFY',
  'LISTEN', 'UNLISTEN', 'PREPARE', 'DEALLOCATE', 'COMMENT', 'SET', 'RESET',
  'LOCK', 'DISCARD', 'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'START',
]);

function normalizeForClassification(sql: string): string {
  let result = '';
  let i = 0;
  const len = sql.length;
  while (i < len) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === '-' && next === '-') {
      while (i < len && sql[i] !== '\n') i++;
      result += ' ';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      let depth = 1;
      while (i < len && depth) {
        if (sql.slice(i, i + 2) === '/*') { depth++; i += 2; }
        else if (sql.slice(i, i + 2) === '*/') { depth--; i += 2; }
        else i++;
      }
      result += ' ';
      continue;
    }
    if (ch === '$') {
      const tag = sql.slice(i).match(/^\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$/)?.[0];
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length);
        i = end < 0 ? len : end + tag.length;
        result += "''";
        continue;
      }
    }
    if (ch === '`' || ch === '[') {
      const closing = ch === '[' ? ']' : '`';
      i++;
      while (i < len) {
        if (sql[i] === closing && sql[i + 1] === closing) { i += 2; continue; }
        if (sql[i++] === closing) break;
      }
      result += ' quoted_identifier ';
      continue;
    }
    if (ch === "'") {
      i++;
      while (i < len) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      result += "''";
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < len) {
        if (sql[i] === '"' && sql[i + 1] === '"') { i += 2; continue; }
        if (sql[i] === '"') { i++; break; }
        i++;
      }
      result += ' quoted_identifier ';
      continue;
    }

    result += ch;
    i++;
  }

  return result.replace(/\s+/g, ' ').trim();
}

function firstKeyword(normalizedUpper: string): string {
  const match = normalizedUpper.match(/^\s*([A-Z]+)/);
  return match ? match[1] : '';
}

// Only a WHERE belonging to this statement restricts its target rows.
function hasOuterWhere(sql: string): boolean {
  let depth = 0;
  for (const token of sql.match(/\(|\)|[A-Z_]+/g) ?? []) {
    if (token === '(') depth++;
    else if (token === ')') { if (depth === 0) break; depth--; }
    else if (token === 'WHERE' && depth === 0) return true;
  }
  return false;
}
function isBulkWriteStatement(sql: string, statement: string): boolean {
  return ['UPDATE', 'DELETE'].includes(statement) && !hasOuterWhere(sql);
}
const INSPECTION_PRAGMAS = new Set([
  'TABLE_INFO', 'TABLE_XINFO', 'TABLE_LIST', 'INDEX_INFO', 'INDEX_XINFO',
  'INDEX_LIST', 'FOREIGN_KEY_LIST', 'FOREIGN_KEY_CHECK', 'INTEGRITY_CHECK',
  'QUICK_CHECK', 'DATABASE_LIST', 'COMPILE_OPTIONS', 'FUNCTION_LIST',
  'MODULE_LIST', 'PRAGMA_LIST', 'COLLATION_LIST',
]);

export function classifyQuery(sql: string): QueryClassification {
  const normalized = normalizeForClassification(sql);
  const upper = normalized.toUpperCase();
  const statement = firstKeyword(upper);

  if (!statement) {
    return { kind: 'unknown', statement: '', isBulkWrite: false, reason: 'Empty or unparseable query' };
  }

  if (TRANSACTION_KEYWORDS.has(statement)) return { kind: 'transaction', statement, isBulkWrite: false };

  if (ADMIN_KEYWORDS.has(statement)) {
    return {
      kind: 'write',
      statement,
      isBulkWrite: false,
    };
  }

  if (DDL_KEYWORDS.has(statement)) {
    return { kind: 'ddl', statement, isBulkWrite: false };
  }

  if (WRITE_KEYWORDS.has(statement)) {
    return {
      kind: 'write',
      statement,
      isBulkWrite: isBulkWriteStatement(upper, statement),
    };
  }

  if (READ_KEYWORDS.has(statement)) {
    if (statement === 'WITH') {
      const writes = [...upper.matchAll(/\b(INSERT|UPDATE|DELETE|MERGE|REPLACE)\b/g)].map(match => ({
        kind: 'write' as const,
        statement: match[1],
        isBulkWrite: isBulkWriteStatement(upper.slice(match.index), match[1]),
      }));
      if (writes.length) return writes.find(c => c.isBulkWrite) ?? writes[0];
    }
    if (statement === 'EXPLAIN' && /\bANALYZE\b/.test(upper) && /\b(INSERT|UPDATE|DELETE|MERGE)\b/.test(upper)) {
      return { kind: 'write', statement, isBulkWrite: false, reason: 'EXPLAIN ANALYZE executes the statement it measures.' };
    }
    if (statement === 'PRAGMA') {
      const name = upper.match(/^PRAGMA\s+(?:\w+\.)?(\w+)/)?.[1] ?? '';
      if (!INSPECTION_PRAGMAS.has(name)) return { kind: 'write', statement, isBulkWrite: false, reason: 'This PRAGMA may change database settings or state.' };
    }
    return { kind: 'read', statement, isBulkWrite: false };
  }

  return {
    kind: 'unknown',
    statement,
    isBulkWrite: false,
    reason: `Unrecognized statement type: ${statement}`,
  };
}

export function requiresTypedConfirmation(c: QueryClassification): boolean {
  if (c.kind === 'ddl' && (c.statement === 'TRUNCATE' || c.statement === 'DROP')) return true;
  if (c.kind === 'write' && c.isBulkWrite) return true;
  return false;
}

export function classifyQueryBatch(sql: string): QueryClassification {
  const items = splitSqlStatements(sql).map(s => classifyQuery(s.text)).filter(c => c.statement);
  return items.find(requiresTypedConfirmation)
    ?? items.find(c => c.kind === 'unknown' || c.kind === 'ddl' || c.kind === 'write')
    ?? items.find(c => c.kind === 'transaction' && ['COMMIT', 'END'].includes(c.statement))
    ?? items[0] ?? classifyQuery('');
}
export function shouldConfirmQuery(c: QueryClassification, mode: 'guided' | 'expert'): boolean {
  if (mode === 'expert') return false;
  return c.kind !== 'read' && !(c.kind === 'transaction' && !['COMMIT', 'END'].includes(c.statement));
}

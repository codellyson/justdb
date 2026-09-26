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
      while (i < len - 1 && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      result += ' ';
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
      let ident = '';
      while (i < len) {
        if (sql[i] === '"' && sql[i + 1] === '"') { ident += '""'; i += 2; continue; }
        if (sql[i] === '"') { i++; break; }
        ident += sql[i];
        i++;
      }
      result += ' ' + ident + ' ';
      continue;
    }

    result += ch;
    i++;
  }

  return result.replace(/\s+/g, ' ').trim();
}

function hasKeyword(normalizedUpper: string, keyword: string): boolean {
  return new RegExp(`\\b${keyword}\\b`).test(normalizedUpper);
}

function firstKeyword(normalizedUpper: string): string {
  const match = normalizedUpper.match(/^\s*([A-Z]+)/);
  return match ? match[1] : '';
}

function isBulkWriteStatement(normalizedUpper: string, statement: string): boolean {
  if (statement !== 'UPDATE' && statement !== 'DELETE') return false;
  return !hasKeyword(normalizedUpper, 'WHERE');
}

function ctEmbedsWrite(normalizedUpper: string): boolean {
  if (!normalizedUpper.startsWith('WITH')) return false;
  return /\b(INSERT|UPDATE|DELETE|MERGE)\b/.test(normalizedUpper);
}

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
    if (statement === 'WITH' && ctEmbedsWrite(upper)) {
      const innerMatch = upper.match(/\b(INSERT|UPDATE|DELETE|MERGE)\b/);
      const inner = innerMatch ? innerMatch[1] : 'UPDATE';
      return {
        kind: 'write',
        statement: inner,
        isBulkWrite: true,
      };
    }
    if ((statement === 'EXPLAIN' && /\bANALYZE\b/.test(upper) && /\b(INSERT|UPDATE|DELETE|MERGE)\b/.test(upper)) || (statement === 'PRAGMA' && /[=(]/.test(upper))) return { kind: 'write', statement, isBulkWrite: true };
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

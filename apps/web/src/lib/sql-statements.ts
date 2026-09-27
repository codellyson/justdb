/**
 * SQL-aware statement splitter. Splits a SQL source on top-level `;`,
 * respecting string literals, identifier quotes, line and block comments,
 * and Postgres dollar-quoted strings ($$...$$ and $tag$...$tag$).
 *
 * Used by the editor's "highlight-to-run" / "run statement at cursor" flow.
 * Naive `;`-split would break on string literals, comments, or function
 * bodies that contain semicolons.
 */

export interface Statement {
  /** char offset of the first non-whitespace char in the statement */
  start: number;
  /** char offset just past the trailing `;`, or sql.length for the last */
  end: number;
  /** trimmed statement text */
  text: string;
}

export function splitSqlStatements(sql: string): Statement[] {
  const statements: Statement[] = [];
  let i = 0;
  let stmtStart = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let blockDepth = 0;
  let identifierEnd: string | null = null;
  // null when not in a dollar quote; otherwise the literal opening tag,
  // including surrounding `$` (e.g. "$$" or "$body$"). The closing tag is
  // identical text.
  let dollarTag: string | null = null;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (blockDepth) {
      if (ch === '/' && next === '*') { blockDepth++; i += 2; continue; }
      if (ch === '*' && next === '/') {
        blockDepth--;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (dollarTag !== null) {
      if (ch === '$' && sql.slice(i, i + dollarTag.length) === dollarTag) {
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      i++;
      continue;
    }
    if (inSingle) {
      if (ch === "'" && next === "'") {
        i += 2; // escaped quote
        continue;
      }
      if (ch === "'") {
        inSingle = false;
        i++;
        continue;
      }
      i++;
      continue;
    }
    if (inDouble) {
      if (ch === '"' && next === '"') {
        i += 2;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (identifierEnd) {
      if (ch === identifierEnd && next === identifierEnd) { i += 2; continue; }
      if (ch === identifierEnd) identifierEnd = null;
      i++;
      continue;
    }

    // Top-level
    if (ch === '`' || ch === '[') {
      identifierEnd = ch === '[' ? ']' : '`';
      i++;
      continue;
    }
    if (ch === '-' && next === '-') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockDepth = 1;
      i += 2;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      i++;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      i++;
      continue;
    }
    if (ch === '$') {
      // $tag$ where tag is empty or [A-Za-z_][A-Za-z0-9_]*
      const after = sql.slice(i + 1);
      const m = after.match(/^([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (m) {
        dollarTag = '$' + (m[1] || '') + '$';
        i += dollarTag.length;
        continue;
      }
    }
    if (ch === ';') {
      const text = sql.slice(stmtStart, i).trim();
      if (text) {
        statements.push({ start: stmtStart, end: i + 1, text });
      }
      stmtStart = i + 1;
      i++;
      continue;
    }
    i++;
  }

  const tail = sql.slice(stmtStart).trim();
  if (tail) {
    statements.push({ start: stmtStart, end: sql.length, text: tail });
  }
  return statements;
}

/**
 * Find the statement at `cursorPos`. When the cursor lies between two
 * statements (e.g. on a blank line), prefer the statement that ends at or
 * before the cursor — that's the one the user just finished writing.
 */
export function getStatementAtCursor(sql: string, cursorPos: number): Statement | null {
  const statements = splitSqlStatements(sql);
  if (statements.length === 0) return null;
  if (statements.length === 1) return statements[0];

  for (const s of statements) {
    if (cursorPos >= s.start && cursorPos <= s.end) return s;
  }
  // Cursor before the first statement → return the first.
  if (cursorPos < statements[0].start) return statements[0];
  // Cursor past the last statement → return the last.
  return statements[statements.length - 1];
}

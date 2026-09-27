import { describe, expect, it } from 'vitest';
import { EditorState } from '@uiw/react-codemirror';
import { PostgreSQL, SQLite, MySQL } from '@codemirror/lang-sql';
import { getSqlHover } from './sql-hover';

describe.each([PostgreSQL, SQLite, MySQL])('SQL hover targeting', dialect => {
  const sql = 'SELECT COUNT(*) AS total FROM orders WHERE id > 0 LIMIT 5;';
  const state = EditorState.create({ doc: sql, extensions: [dialect.language] });
  it.each(['SELECT', 'COUNT', 'AS', 'FROM', 'WHERE', 'LIMIT'])('explains the hovered %s token', token => {
    const from = sql.indexOf(token);
    const result = getSqlHover(state, from + 1, 1);
    expect(result?.title).toBe(token);
    expect(result?.from).toBe(from);
    expect(result?.to).toBe(from + token.length);
  });
  it('does not explain identifiers, strings, comments, or whitespace as SELECT', () => {
    const doc = 'SELECT orders, "LIMIT", \'WHERE\' /* FROM */ FROM orders;';
    const sample = EditorState.create({ doc, extensions: [dialect.language] });
    for (const token of ['orders', 'LIMIT', 'WHERE', '/* FROM */']) {
      expect(getSqlHover(sample, doc.indexOf(token) + 2, 1)).toBeNull();
    }
    expect(getSqlHover(sample, 6, 1)).toBeNull();
  });
});

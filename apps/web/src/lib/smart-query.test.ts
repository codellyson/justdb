import { describe, expect, it } from 'vitest';
import { PostgreSQL } from '@codemirror/lang-sql';
import { explainStatement } from './smart-query';

describe('local statement explanations', () => {
  it('explains writes within CTEs and executing explain statements accurately', () => {
    expect(explainStatement('WITH removed AS (DELETE FROM users RETURNING *) SELECT * FROM removed')?.title).toBe('DELETE');
    expect(explainStatement('EXPLAIN ANALYZE DELETE FROM users')?.description).toContain('executes');
  });
  it('does not infer SQL from comments and provides an honest fallback', () => {
    expect(explainStatement('-- DELETE FROM users')).toBeNull();
    expect(explainStatement('FUTURE_COMMAND users')?.description).toContain('No local explanation');
  });
  it('has keyword hover targets in the actual SQL parser', () => {
    const names: string[] = [];
    PostgreSQL.language.parser.parse('SELECT * FROM users').iterate({ enter(node) { names.push(node.name); } });
    expect(names).toContain('Keyword');
  });
});

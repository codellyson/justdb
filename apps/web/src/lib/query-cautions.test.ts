import { describe, expect, it } from 'vitest';
import { classifyQuery, classifyQueryBatch, requiresTypedConfirmation, shouldConfirmQuery } from './query-classifier';

describe('caution scope and severity', () => {
  it.each([
    'UPDATE users SET bio = (SELECT bio FROM users WHERE id = 1)',
    'DELETE FROM users RETURNING (SELECT id FROM products WHERE stock > 0)',
    'UPDATE users SET "WHERE" = 1',
    'UPDATE users SET bio = $$WHERE id = 1$$',
    'UPDATE users SET `WHERE` = 1',
    'UPDATE users SET [WHERE] = 1',
    'WITH selected AS (SELECT id FROM users WHERE id = 1) DELETE FROM users',
  ])('requires bulk confirmation for %s', sql => {
    expect(requiresTypedConfirmation(classifyQuery(sql))).toBe(true);
  });
  it.each([
    'UPDATE users SET bio = (SELECT bio FROM users WHERE id = 1) WHERE id = 2',
    'WITH selected AS (SELECT id FROM users) DELETE FROM users WHERE id IN (SELECT id FROM selected)',
    "WITH deleted AS (DELETE FROM users WHERE id = 1 RETURNING *) SELECT * FROM deleted",
  ])('does not describe a scoped write as every row: %s', sql => {
    const c = classifyQuery(sql);
    expect(c.kind).toBe('write');
    expect(c.isBulkWrite).toBe(false);
    expect(shouldConfirmQuery(c, 'guided')).toBe(true);
  });
  it.each(['PRAGMA table_info(users)', 'PRAGMA main.table_xinfo(users)', 'PRAGMA index_list(users)', 'PRAGMA foreign_key_check'])('allows inspection %s', sql => {
    expect(shouldConfirmQuery(classifyQuery(sql), 'guided')).toBe(false);
  });
  it.each(['PRAGMA foreign_keys = OFF', 'PRAGMA journal_mode(WAL)', 'PRAGMA optimize'])('reviews stateful pragma without a false every-row warning: %s', sql => {
    const c = classifyQuery(sql);
    expect(shouldConfirmQuery(c, 'guided')).toBe(true);
    expect(c.isBulkWrite).toBe(false);
  });
  it('reviews EXPLAIN ANALYZE writes without asserting a missing WHERE', () => {
    const c = classifyQuery('EXPLAIN ANALYZE DELETE FROM users WHERE id = 1');
    expect(c.kind).toBe('write');
    expect(c.reason).toContain('executes');
    expect(c.isBulkWrite).toBe(false);
  });
  it('retains Expert bypass and checks the riskiest statement in a batch', () => {
    const c = classifyQueryBatch('SELECT 1; DELETE FROM users;');
    expect(requiresTypedConfirmation(c)).toBe(true);
    expect(shouldConfirmQuery(c, 'expert')).toBe(false);
  });
});

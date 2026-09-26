import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyQueryBatch, shouldConfirmQuery } from './query-classifier';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
import { db } from './db';
let mode = 'guided';
beforeEach(async () => {
  mode = 'guided';
  vi.stubGlobal('localStorage', { getItem: () => mode });
  invoke.mockReset();
  invoke.mockResolvedValue({ sessionId: 'test', database: 'fixture', dbType: 'sqlite' });
  await db.connect({ type: 'sqlite', host: '', port: 0, username: '', password: '', database: 'fixture' });
  invoke.mockClear();
  invoke.mockResolvedValue({ rows: [], fields: [], executionTime: 1 });
});
describe('query experience modes', () => {
  it('checks every selected statement before executing any SQL', async () => {
    const result = await db.runQuery('SELECT 1; DROP TABLE tasks;');
    expect(result.needsConfirmation).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });
  it('runs destructive SQL directly in Expert mode', async () => {
    mode = 'expert';
    expect((await db.runQuery('DROP TABLE tasks')).needsConfirmation).toBeUndefined();
    expect(invoke).toHaveBeenCalledWith('db_run_query', { sessionId: 'test', sql: 'DROP TABLE tasks' });
  });
  it('runs a confirmed transaction in order on the same session', async () => {
    await db.runQuery('BEGIN; DELETE FROM tasks; COMMIT;', true);
    expect(invoke.mock.calls.map(call => call[1].sql)).toEqual(['BEGIN', 'DELETE FROM tasks', 'COMMIT']);
  });
  it('rolls back a failed selected transaction and never commits it', async () => {
    invoke.mockResolvedValueOnce({ rows: [], fields: [], executionTime: 1 }).mockRejectedValueOnce(new Error('constraint'));
    await expect(db.runQuery('BEGIN; DELETE FROM tasks; COMMIT;', true)).rejects.toThrow('constraint');
    expect(invoke.mock.calls.map(call => call[1].sql)).toEqual(['BEGIN', 'DELETE FROM tasks', 'ROLLBACK']);
  });
  it('allows transaction control and warns for a Guided commit', () => {
    expect(shouldConfirmQuery(classifyQueryBatch('BEGIN'), 'guided')).toBe(false);
    expect(shouldConfirmQuery(classifyQueryBatch('ROLLBACK'), 'guided')).toBe(false);
    expect(shouldConfirmQuery(classifyQueryBatch('COMMIT'), 'guided')).toBe(true);
  });
  it('does not treat semicolons in strings or function bodies as statements', () => {
    expect(classifyQueryBatch("SELECT 'DROP TABLE t;'").kind).toBe('read');
    expect(classifyQueryBatch('DO $$ BEGIN DELETE FROM t; END $$').kind).toBe('write');
  });
  it('allows administrative SQL after Guided confirmation', async () => {
    expect((await db.runQuery('VACUUM')).needsConfirmation).toBe(true);
    await db.runQuery('VACUUM', true);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

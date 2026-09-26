import { beforeEach, expect, it, vi } from 'vitest';
import { installedProviders, providerForConfig, setProviderInstalled } from './connector-catalog';
import type { DBConfig } from '@/types';
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal('window', { dispatchEvent: vi.fn() });
});
it('persists optional provider install and removal without affecting defaults', () => {
  expect(installedProviders()).toEqual([]);
  setProviderInstalled('d1', true);
  setProviderInstalled('turso', true);
  setProviderInstalled('d1', true);
  expect(installedProviders()).toEqual(['d1', 'turso']);
  setProviderInstalled('d1', false);
  expect(installedProviders()).toEqual(['turso']);
});
it('recovers from invalid stored provider data', () => {
  storage.set('justdb-installed-sqlite-providers', '{}');
  expect(installedProviders()).toEqual([]);
});
it('identifies provider from the connection config, not its display name', () => {
  const config: DBConfig = { type: 'sqlite', filepath: '/tmp/d1.sqlite', host: '', port: 0, database: '', username: '', password: '' };
  expect(providerForConfig(config)).toBe('sqlite');
  expect(providerForConfig({ ...config, filepath: 'd1://account/database' })).toBe('d1');
  expect(providerForConfig({ ...config, filepath: 'libsql://example.turso.io' })).toBe('turso');
  expect(providerForConfig({ ...config, type: 'postgresql' })).toBe('postgresql');
});

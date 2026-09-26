import { useSyncExternalStore } from 'react';
import type { DBConfig } from '@/types';

export type SqliteProvider = 'd1' | 'turso';
const KEY = 'justdb-installed-sqlite-providers';
const EVENT = 'justdb:providers-changed';
export function installedProviders(): SqliteProvider[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]').filter((id: unknown) => id === 'd1' || id === 'turso'); }
  catch { return []; }
}
export function setProviderInstalled(id: SqliteProvider, installed: boolean) {
  const next = new Set(installedProviders());
  if (installed) next.add(id); else next.delete(id);
  localStorage.setItem(KEY, JSON.stringify([...next]));
  window.dispatchEvent(new Event(EVENT));
}
function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback); window.addEventListener('storage', callback);
  return () => { window.removeEventListener(EVENT, callback); window.removeEventListener('storage', callback); };
}
export function useInstalledProviders() {
  const value = useSyncExternalStore(subscribe, () => installedProviders().join(','));
  return value.split(',').filter(Boolean) as SqliteProvider[];
}
export function providerForConfig(config: DBConfig): 'postgresql' | 'sqlite' | SqliteProvider {
  if (config.type !== 'sqlite') return 'postgresql';
  if (/^d1:\/\//i.test(config.filepath ?? '')) return 'd1';
  if (/^(libsql|https?):\/\//i.test(config.filepath ?? '')) return 'turso';
  return 'sqlite';
}

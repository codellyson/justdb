import { pgOidToType } from './pg-types';
import type { QueryFieldInfo } from './db-provider';

export function queryColumnTypes(fields: QueryFieldInfo[] | undefined, dialect: string): Record<string, string> {
  if (dialect !== 'postgresql') return {};
  return Object.fromEntries((fields ?? []).filter(field => typeof field.dataTypeID === 'number')
    .map(field => [field.name, pgOidToType(field.dataTypeID!)]));
}

export function formatQueryDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  return ms < 1 ? '<1 ms' : `${Math.round(ms).toLocaleString()} ms`;
}

/** Sample bounded data; explicit user sizing always wins. Grow text columns only. */
export function fitQueryColumns(columns: string[], rows: Record<string, unknown>[], overrides: Record<string, number>, available: number): Record<string, number> {
  const widths: Record<string, number> = {};
  const flexible: string[] = [];
  for (const column of columns) {
    if (overrides[column] !== undefined) { widths[column] = overrides[column]; continue; }
    const values = rows.slice(0, 50).map(row => row[column]).filter(value => value != null);
    const numeric = values.length > 0 && values.every(value => typeof value === 'number' || typeof value === 'boolean');
    const longest = Math.max(column.length, ...values.map(value => Math.min(100, String(value).length)));
    widths[column] = Math.min(numeric ? 160 : 480, Math.max(numeric ? 88 : 160, longest * 8 + 40));
    if (!numeric) flexible.push(column);
  }
  const remaining = Math.max(0, available - Object.values(widths).reduce((sum, width) => sum + width, 0));
  for (const column of flexible) widths[column] += remaining / flexible.length;
  return widths;
}

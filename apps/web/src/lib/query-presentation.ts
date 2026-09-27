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

/** Distribute spare space evenly; explicit user resizing still wins. */
export function fitQueryColumns(columns: string[], _rows: Record<string, unknown>[], overrides: Record<string, number>, available: number): Record<string, number> {
  const flexible = columns.filter(column => overrides[column] === undefined);
  const fixedWidth = columns.reduce((sum, column) => sum + (overrides[column] ?? 0), 0);
  const width = Math.max(200, flexible.length ? (available - fixedWidth) / flexible.length : 200);
  return Object.fromEntries(columns.map(column => [column, overrides[column] ?? width]));
}

import { ArrowUpRight, Check, Copy, X } from 'lucide-react';
import { useState } from 'react';
import type { ForeignKeyClickArgs, ForeignKeyTarget } from './query-result-grid';

interface RowInspectorProps {
  row: Record<string, any>;
  index: number;
  offset: number;
  columns: string[];
  columnTypes: Record<string, string>;
  foreignKeys: Record<string, ForeignKeyTarget>;
  onForeignKeyClick: (args: ForeignKeyClickArgs) => void;
  onClose: () => void;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

export function RowInspector({ row, index, offset, columns, columnTypes, foreignKeys, onForeignKeyClick, onClose }: RowInspectorProps) {
  const [copied, setCopied] = useState(false);

  const copyRow = async () => {
    await navigator.clipboard.writeText(JSON.stringify(row, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <aside aria-label={`Row ${offset + index + 1} details`} className="flex h-full w-[min(100vw,340px)] flex-col border-l border-border bg-bg shadow-xl lg:shadow-none">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-primary">Row {offset + index + 1}</h2>
          <p className="text-xs text-muted">Select another cell to inspect its row</p>
        </div>
        <button type="button" onClick={copyRow} title="Copy row as JSON" aria-label="Copy row as JSON" className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-bg-secondary hover:text-primary focus-visible:outline-2 focus-visible:outline-accent">
          {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
        </button>
        <button type="button" onClick={onClose} title="Close row details" aria-label="Close row details" className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-bg-secondary hover:text-primary focus-visible:outline-2 focus-visible:outline-accent">
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        {columns.map((column) => {
          const value = row[column];
          const foreignKey = foreignKeys[column];
          return (
            <div key={column} className="border-b border-border py-3 last:border-b-0">
              <div className="mb-1.5 flex min-w-0 items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-medium text-secondary" title={column}>{column}</span>
                {foreignKey && <span className="shrink-0 text-meta text-accent">FK → {foreignKey.table}</span>}
                <span className="max-w-24 shrink-0 truncate font-mono text-meta text-muted" title={columnTypes[column]}>{columnTypes[column]}</span>
              </div>
              <div className="flex min-h-9 items-start gap-1 rounded-md border border-border bg-bg-secondary/40 px-2.5 py-2">
                <span className={`min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-xs leading-5 ${value == null ? 'italic text-muted' : 'text-primary'}`}>
                  {displayValue(value)}
                </span>
                {foreignKey && value != null && (
                  <button
                    type="button"
                    onClick={() => onForeignKeyClick({ sourceColumn: column, fk: foreignKey, value })}
                    title={`Open related ${foreignKey.table} row`}
                    aria-label={`Open related ${foreignKey.table} row`}
                    className="flex size-6 shrink-0 items-center justify-center rounded text-accent hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <ArrowUpRight className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="shrink-0 border-t border-border px-4 py-3 text-meta text-muted">Double-click a cell in the grid to edit it.</div>
    </aside>
  );
}

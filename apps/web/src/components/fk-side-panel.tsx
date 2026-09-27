
import React, { useEffect, useState, useCallback } from 'react';
import { db } from '@/lib/db';
import type { ForeignKeyTarget } from './query-result-grid';
import { ExternalLink, X } from 'lucide-react';

export interface FKQuery {
  /** column on the source row that initiated the lookup, for breadcrumb display */
  sourceColumn: string;
  fk: ForeignKeyTarget;
  value: any;
}

interface FKSidePanelProps {
  query: FKQuery | null;
  onClose: () => void;
  /**
   * Open the looked-up row's table in a new dashboard tab. The panel calls
   * this with the FK target schema/table.
   */
  onOpenTable: (schema: string, table: string) => void;
  /**
   * Recursively follow another FK from inside the panel. The same panel
   * just rebinds to the new query.
   */
  onFollow: (next: FKQuery) => void;
}

export const FKSidePanel: React.FC<FKSidePanelProps> = ({
  query,
  onClose,
  onOpenTable,
  onFollow,
}) => {
  const [rows, setRows] = useState<any[]>([]);
  const [targetFks, setTargetFks] = useState<Record<string, ForeignKeyTarget>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch the target row + its FK relationships in parallel whenever the
  // query changes. The relationships are used to render outbound FK links
  // inside the panel for chained navigation.
  useEffect(() => {
    if (!query) {
      setRows([]);
      setTargetFks({});
      setError(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setRows([]);
    setTargetFks({});
    Promise.all([
      db.lookupRow({
        schema: query.fk.schema,
        table: query.fk.table,
        column: query.fk.column,
        value: query.value,
      }),
      db.relationships(query.fk.table, query.fk.schema).catch(
        () => ({ relationships: [], indexes: [] } as { relationships: any[]; indexes: any[] }),
      ),
    ])
      .then(([rowData, relData]) => {
        if (cancelled) return;
        setRows(rowData.rows || []);
        const map: Record<string, ForeignKeyTarget> = {};
        for (const r of (relData.relationships || [])) {
          if (r.source_column && r.target_table) {
            map[r.source_column] = {
              schema: r.target_schema || query.fk.schema,
              table: r.target_table,
              column: r.target_column,
            };
          }
        }
        setTargetFks(map);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(err.message || 'Failed to load related row');
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  // Esc closes from anywhere.
  useEffect(() => {
    if (!query) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [query, onClose]);

  const formatVal = useCallback((v: any): string => {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }, []);

  if (!query || typeof window === 'undefined') return null;

  const row = rows[0];
  const tooManyRows = rows.length > 1;

  return (
      <aside
        className="relative h-screen w-[26rem] max-w-[85vw] flex-shrink-0 flex flex-col bg-bg border-l border-border"
        aria-label="Related row"
      >
        <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border flex-shrink-0">
          <div className="min-w-0">
            <div className="text-xs text-muted truncate">
              {query.sourceColumn} → {query.fk.schema}.{query.fk.table}
            </div>
            <div className="text-sm font-medium text-primary truncate">
              {query.fk.table}
              <span className="text-muted ml-2 font-mono">
                {query.fk.column} = {formatVal(query.value)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => onOpenTable(query.fk.schema, query.fk.table)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
              title="Open this table in a new tab"
            >
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              Open table
            </button>
            <button
              onClick={onClose}
              className="p-1 text-muted hover:text-primary hover:bg-bg-secondary rounded-sm transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="p-4 text-sm text-muted">Loading…</div>
          )}
          {error && (
            <div className="p-4 text-sm text-danger">{error}</div>
          )}
          {!isLoading && !error && !row && (
            <div className="p-4 text-sm text-muted">
              No row found where {query.fk.column} = {formatVal(query.value)}.
            </div>
          )}
          {tooManyRows && (
            <div className="px-4 py-2 bg-warning/10 text-xs text-warning border-b border-border">
              FK target returned more than one row. Showing the first.
            </div>
          )}
          {row && (
            <dl className="divide-y divide-border">
              {Object.entries(row).map(([col, val]) => {
                const fk = targetFks[col];
                const isFkLink = !!fk && val !== null && val !== undefined;
                return (
                  <div key={col} className="px-4 py-2">
                    <dt className="text-meta font-medium text-secondary uppercase tracking-wide">
                      {col}
                    </dt>
                    <dd className="mt-0.5 text-sm font-mono text-primary break-all whitespace-pre-wrap">
                      {val === null || val === undefined ? (
                        <span className="text-muted italic">NULL</span>
                      ) : isFkLink ? (
                        <button
                          onClick={() =>
                            onFollow({
                              sourceColumn: col,
                              fk: fk!,
                              value: val,
                            })
                          }
                          className="text-blue-400 hover:text-blue-300 hover:underline text-left break-all"
                          title={`Follow → ${fk!.schema}.${fk!.table}.${fk!.column}`}
                        >
                          {formatVal(val)}
                        </button>
                      ) : (
                        formatVal(val)
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
        </div>
      </aside>
  );
};

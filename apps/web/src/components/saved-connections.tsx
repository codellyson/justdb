import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database, Search, Trash2 } from 'lucide-react';
import { useConnection } from '../contexts/connection-context';
import { useToast } from '../contexts/toast-context';
import { Button } from './ui/button';
import { ConfirmDialog } from './ui/confirm-dialog';
import { describeConnection } from '@/lib/connection-url';
import { ConnectorLogo, type ConnectorKind } from './connector-logo';

export const SavedConnections: React.FC = () => {
  const { savedConnections, currentConnectionId, connectToSaved, deleteConnection, isConnecting } = useConnection();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const visible = savedConnections.filter((connection) =>
    `${connection.name} ${describeConnection(connection.config)}`.toLowerCase().includes(filter.trim().toLowerCase())
  );
  const deleting = savedConnections.find((connection) => connection.id === deleteTarget);

  const handleConnect = async (connectionId: string) => {
    try {
      await connectToSaved(connectionId);
      addToast('Connected successfully', 'success');
      navigate('/');
    } catch (err) {
      console.error('Failed to connect:', err);
    }
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteConnection(deleteTarget);
    addToast('Connection deleted', 'info');
    setDeleteTarget(null);
  };

  return (
    <section aria-labelledby="saved-connections-title" className="overflow-hidden rounded-xl border border-border bg-bg-secondary/50">
      <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-2">
          <h2 id="saved-connections-title" className="text-sm font-semibold text-primary">Saved connections</h2>
          <span className="rounded-full bg-bg px-2 py-0.5 text-xs text-secondary">{savedConnections.length}</span>
        </div>
        {savedConnections.length > 0 && <label className="relative block w-full sm:w-44">
          <Search aria-hidden="true" className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" strokeWidth={1.5} />
          <span className="sr-only">Filter saved connections</span>
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter..."
            className="h-9 w-full rounded-lg border border-border bg-bg pl-9 pr-3 text-xs text-primary placeholder:text-muted focus:border-accent focus:outline-none"
          />
        </label>}
      </div>
      <div className="border-t border-border">
        {visible.map((connection) => {
          const isD1 = connection.config.type === 'sqlite' && connection.config.filepath?.startsWith('d1://');
          const isSqlite = connection.config.type === 'sqlite' && !isD1;
          const kind: ConnectorKind = isD1 ? 'd1' : isSqlite ? 'sqlite' : 'postgresql';
          const kindLabel = isD1 ? 'Cloudflare D1' : isSqlite ? 'SQLite' : 'PostgreSQL';
          return (
            <div key={connection.id} className="flex min-h-16 items-center gap-3 border-b border-border px-5 py-2.5 last:border-b-0 hover:bg-bg-secondary">
              <span aria-label={kindLabel} className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${isD1 ? 'bg-amber-500/15' : isSqlite ? 'bg-emerald-500/15' : 'bg-accent/15'}`}>
                <ConnectorLogo kind={kind} className="size-6" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-primary" title={connection.name}>{connection.name}</p>
                  {connection.id === currentConnectionId && <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">Current</span>}
                </div>
                <p className="truncate font-mono text-[11px] text-muted" title={describeConnection(connection.config)}>{describeConnection(connection.config)}</p>
              </div>
              {connection.id !== currentConnectionId && (
                <Button variant="secondary" size="sm" onClick={() => void handleConnect(connection.id)} disabled={isConnecting}>
                  Connect
                </Button>
              )}
              <button
                type="button"
                onClick={() => setDeleteTarget(connection.id)}
                disabled={isConnecting}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                aria-label={`Delete ${connection.name}`}
                title={`Delete ${connection.name}`}
              >
                <Trash2 className="size-4" strokeWidth={1.5} />
              </button>
            </div>
          );
        })}
        {visible.length === 0 && (
          <div className="flex min-h-28 flex-col items-center justify-center gap-2 px-5 text-center text-xs text-muted">
            <Database className="size-5" strokeWidth={1.5} aria-hidden="true" />
            {savedConnections.length === 0 ? 'No saved connections yet.' : 'No connections match your filter.'}
          </div>
        )}
      </div>
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
        title="Delete connection"
        message={`Delete “${deleting?.name ?? 'this connection'}”? This removes its saved details and cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />
    </section>
  );
};

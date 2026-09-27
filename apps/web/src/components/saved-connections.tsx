import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database, Search, Trash2 } from 'lucide-react';
import { useConnection } from '../contexts/connection-context';
import { useToast } from '../contexts/toast-context';
import { Button } from './ui/button';
import { ConfirmDialog } from './ui/confirm-dialog';
import { describeConnection } from '@/lib/connection-url';
import { ConnectorBadge, type ConnectorKind } from './connector-logo';

export const SavedConnections: React.FC = () => {
  const { savedConnections, currentConnectionId, connectToSaved, deleteConnection, isConnecting } = useConnection();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const visible = savedConnections.filter((connection) =>
    `${connection.name} ${describeConnection(connection.config)}`.toLowerCase().includes(filter.trim().toLowerCase())
  );

  const handleConnect = async (connectionId: string) => {
    try {
      await connectToSaved(connectionId);
      addToast('Connected successfully', 'success');
      navigate('/');
    } catch (err) {
      console.error('Failed to connect:', err);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await deleteConnection(deleteTarget);
    addToast('Saved connection removed', 'info');
    setDeleteTarget(null);
  };

  return (
    <section aria-labelledby="saved-connections-title" className="connection-card overflow-hidden rounded-xl border border-border bg-bg">
      <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-baseline gap-2">
          <h2 id="saved-connections-title" className="text-sm font-semibold text-primary">Saved connections</h2>
          <span className="text-sm leading-5 tabular-nums text-secondary">{savedConnections.length}</span>
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
          return (
            <div key={connection.id} className="connection-row flex min-h-16 items-center gap-3 border-b border-border px-5 py-2.5 last:border-b-0 hover:bg-bg-secondary">
              <ConnectorBadge kind={kind} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-primary" title={connection.name}>{connection.name}</p>
                  {connection.id === currentConnectionId && <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-meta text-accent">Current</span>}
                </div>
                <p className="truncate font-mono text-meta text-muted" title={describeConnection(connection.config)}>{describeConnection(connection.config)}</p>
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
          <div className="flex min-h-44 flex-col items-center justify-center gap-3 px-6 py-8 text-center">
            <span className="flex size-11 items-center justify-center rounded-xl border border-border bg-bg-secondary/50 text-secondary"><Database className="size-5" strokeWidth={1.5} aria-hidden="true" /></span>
            <div>
              <p className="text-sm font-medium text-primary">{savedConnections.length === 0 ? 'Your workspace starts here' : 'No matching connections'}</p>
              <p className="mt-1 max-w-72 text-xs leading-relaxed text-muted">{savedConnections.length === 0 ? 'Add a connection above. Save it to pick up right where you left off.' : 'Try a different name, host, or database.'}</p>
            </div>
          </div>
        )}
      </div>
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
        title="Remove saved connection?"
        message={`Remove “${savedConnections.find(c => c.id === deleteTarget)?.name ?? 'this connection'}” from your saved connections? Its saved connection details will be removed. The database and its data will not be deleted.`}
        confirmText="Remove connection"
        variant="danger"
      />
    </section>
  );
};

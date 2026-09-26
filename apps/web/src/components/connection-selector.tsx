
import React, { useState } from 'react';
import { useConnection } from '../contexts/connection-context';
import { useToast } from '../contexts/toast-context';
import { ConfirmDialog } from './ui/confirm-dialog';
import { describeConnection } from '@/lib/connection-url';
import { ChevronDown, Loader2, LogOut, X } from 'lucide-react';

interface ConnectionSelectorProps {
  status: 'connected' | 'connecting' | 'disconnected';
  databaseName?: string;
  tableCount?: number;
  latency?: number | null;
  onDisconnect: () => void;
}

const dotColor: Record<ConnectionSelectorProps['status'], string> = {
  connected: 'bg-success',
  connecting: 'bg-warning',
  disconnected: 'bg-muted',
};

export const ConnectionSelector: React.FC<ConnectionSelectorProps> = ({
  status,
  databaseName,
  tableCount,
  latency,
  onDisconnect,
}) => {
  const {
    savedConnections,
    currentConnectionId,
    connectToSaved,
    deleteConnection,
    isConnecting,
  } = useConnection();
  const { addToast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  const currentConnection = savedConnections.find(c => c.id === currentConnectionId);
  const label = currentConnection?.name ?? databaseName ?? 'Connection';

  const handleSwitch = async (connectionId: string) => {
    if (connectionId === currentConnectionId) {
      setIsOpen(false);
      return;
    }
    setSwitchingTo(connectionId);
    try {
      await connectToSaved(connectionId);
      setIsOpen(false);
      addToast('Connection switched', 'success');
    } catch (err) {
      console.error('Failed to switch connection:', err);
      addToast('Failed to switch connection', 'error');
    } finally {
      setSwitchingTo(null);
    }
  };

  const handleDelete = (e: React.MouseEvent, connectionId: string) => {
    e.stopPropagation();
    setDeleteTarget(connectionId);
  };

  const confirmDelete = () => {
    if (deleteTarget) {
      deleteConnection(deleteTarget);
      addToast('Connection deleted', 'info');
      setDeleteTarget(null);
    }
  };

  return (
    <div
      className="relative"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && isOpen) {
          setIsOpen(false);
        }
      }}
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-2 text-sm font-medium rounded-md border border-border px-3 py-1.5 bg-bg text-primary hover:bg-bg-secondary transition-colors"
        disabled={isConnecting}
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <span
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor[status]} ${
            status === 'connecting' ? 'animate-pulse' : ''
          }`}
        />
        <span className="truncate max-w-[160px]">{label}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-muted flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => !isConnecting && setIsOpen(false)}
            aria-hidden="true"
          />
          {/* An absolutely-positioned box shrink-wraps its content, so without a
              max-width a long connection subtitle stretches the whole panel and
              the inner `truncate` never has a width to clip against. */}
          <div className="absolute top-full right-0 mt-2 z-20 bg-bg border border-border rounded-lg shadow-lg min-w-[240px] max-w-[min(24rem,calc(100vw-2rem))] overflow-hidden" role="menu" aria-label="Connection">
            {status !== 'disconnected' && (
              <div className="px-3 py-2.5 border-b border-border bg-bg-secondary">
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor[status]}`} />
                  <span className="text-sm font-mono text-primary truncate">
                    {databaseName ?? label}
                  </span>
                </div>
                <p className="text-xs text-muted mt-1">
                  {tableCount !== undefined && tableCount > 0 && (
                    <>{tableCount} {tableCount === 1 ? 'table' : 'tables'}</>
                  )}
                  {latency != null && (
                    <>{tableCount ? ' · ' : ''}{latency}ms</>
                  )}
                  {status === 'connecting' && 'Reconnecting…'}
                </p>
              </div>
            )}

            {savedConnections.length > 0 && (
              <>
                <div className="px-3 py-2 border-b border-border">
                  <p className="text-xs font-medium text-muted">Saved connections</p>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {savedConnections.map((connection) => (
                    <div
                      key={connection.id}
                      role="menuitem"
                      aria-current={connection.id === currentConnectionId}
                      className={`px-3 py-2.5 border-b border-border last:border-b-0 cursor-pointer transition-colors ${
                        connection.id === currentConnectionId
                          ? 'bg-accent/10 text-accent'
                          : 'text-primary hover:bg-bg-secondary'
                      }`}
                      onClick={() => !isConnecting && handleSwitch(connection.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {connection.name}
                          </p>
                          <p className="text-xs font-mono text-muted truncate">
                            {isConnecting && switchingTo === connection.id
                              ? 'Connecting...'
                              : describeConnection(connection.config)}
                          </p>
                        </div>
                        {isConnecting && switchingTo === connection.id ? (
                          <Loader2 className="ml-2 h-4 w-4 animate-spin text-accent flex-shrink-0" />
                        ) : (
                          <button
                            onClick={(e) => handleDelete(e, connection.id)}
                            className="ml-2 flex items-center justify-center w-6 h-6 rounded-sm text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                            aria-label={`Delete connection ${connection.name}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <button
              role="menuitem"
              onClick={() => { setIsOpen(false); onDisconnect(); }}
              disabled={isConnecting}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-danger border-t border-border hover:bg-danger/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <LogOut className="w-3.5 h-3.5 flex-shrink-0" />
              Disconnect
            </button>
          </div>
        </>
      )}
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
        title="Delete connection"
        message="Are you sure you want to delete this connection?"
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
};

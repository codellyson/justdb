import { useCallback, useEffect, useRef, useState } from 'react';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { useConnection } from '../contexts/connection-context';
import { ConnectionForm } from '../components/connection-form';
import { SavedConnections } from '../components/saved-connections';
import { Button } from '../components/ui/button';
import { AnimatedViews } from '../components/ui/animated-views';
import type { DBConfig } from '../types';
import { db, type LocalDatabase, type LocalSqliteFile } from '../lib/db';
import { localPathLabel } from '../lib/local-path-label';
import { sqliteDisplayName } from '../lib/connection-url';
import { ArrowLeft, Plus, RefreshCw, Settings } from 'lucide-react';
import { ConnectorBadge } from '../components/connector-logo';

// The disconnected landing — saved connections + new-connection form.
// Rendered inline by `Home` when there's no active session. There's no
// dedicated route any more; this component is just the !isConnected view
// of `/`.
export function Connections() {
  const { isConnecting, connect, connectToSaved, cancelConnect, error, savedConnections } = useConnection();
  const [view, setView] = useState<'saved' | 'new'>('saved');
  const [detected, setDetected] = useState<LocalDatabase[]>([]);
  const [scanning, setScanning] = useState(true);
  const [scanError, setScanError] = useState(false);
  const [selected, setSelected] = useState<{
    selection: number;
    config: DBConfig;
    name: string;
    savedConnectionId?: string;
  }>();
  const [localDbType, setLocalDbType] = useState<'postgresql' | 'sqlite'>('postgresql');
  const [sqliteFiles, setSqliteFiles] = useState<LocalSqliteFile[]>([]);
  const [sqliteFolder, setSqliteFolder] = useState<string>();
  const [sqliteScanning, setSqliteScanning] = useState(false);
  const [sqliteScanError, setSqliteScanError] = useState(false);
  const sqliteScanStarted = useRef(false);
  const [selectedSqlite, setSelectedSqlite] = useState<{
    path: string;
    name: string;
    readOnly: boolean;
    selection: number;
  }>();

  const scanLocal = useCallback(async () => {
    setScanning(true);
    setScanError(false);
    try {
      setDetected(await db.discoverLocal());
    } catch {
      setScanError(true);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => { void scanLocal(); }, [scanLocal]);

  const scanSqlite = useCallback(async (folder?: string) => {
    setSqliteScanning(true);
    setSqliteScanError(false);
    try {
      setSqliteFiles(await db.discoverSqlite(folder));
    } catch {
      setSqliteScanError(true);
    } finally {
      setSqliteScanning(false);
    }
  }, []);

  useEffect(() => {
    if (localDbType !== 'sqlite' || sqliteScanStarted.current) return;
    sqliteScanStarted.current = true;
    void scanSqlite();
  }, [localDbType, scanSqlite]);

  const chooseSqliteFolder = async () => {
    try {
      const folder = await openFileDialog({ directory: true, multiple: false });
      if (typeof folder !== 'string') return;
      setSqliteFolder(folder);
      setSqliteFiles([]);
      void scanSqlite(folder);
    } catch {
      setSqliteScanError(true);
    }
  };

  const handleConnect = async (config: DBConfig, name?: string) => {
    try {
      // No explicit navigation — once connect() flips isConnected, Home
      // re-renders and replaces this view with the Dashboard.
      await connect(config, name);
    } catch (err) {
      console.error('Connection error:', err);
    }
  };

  const handleConnectSaved = async (id: string) => {
    try {
      await connectToSaved(id);
    } catch (err) {
      console.error('Saved connection error:', err);
    }
  };

  const useDetected = (instance: LocalDatabase) => {
    setLocalDbType('postgresql');
    // A protocol probe reveals the server and port, but not database names
    // or credentials. Reuse the most recently used local saved connection
    // for that port when one exists.
    const saved = savedConnections
      .filter((connection) =>
        (connection.config.type === undefined || connection.config.type === 'postgresql') &&
        ['localhost', '127.0.0.1', '::1'].includes(connection.config.host.toLowerCase()) &&
        connection.config.port === instance.port
      )
      .sort((a, b) => (b.lastUsed ?? b.createdAt) - (a.lastUsed ?? a.createdAt))[0];

    setSelected((previous) => ({
      selection: (previous?.selection ?? 0) + 1,
      config: saved
        ? { ...saved.config, password: '', type: 'postgresql' }
        : {
            host: instance.host,
            port: instance.port,
            database: 'postgres',
            username: 'postgres',
            password: '',
            ssl: false,
            type: 'postgresql',
          },
      name: saved?.name ?? `Local PostgreSQL (${instance.port})`,
      savedConnectionId: saved?.id,
    }));
    setView('new');
  };

  const useSqliteFile = (file: LocalSqliteFile) => {
    setLocalDbType('sqlite');
    setSelectedSqlite((previous) => ({
      path: file.path,
      name: file.source === 'd1-local'
        ? `D1 ${file.project ?? 'local'} (${sqliteDisplayName(file.path)})`
        : sqliteDisplayName(file.path),
      readOnly: file.source === 'd1-local',
      selection: (previous?.selection ?? 0) + 1,
    }));
    setView('new');
  };

  const displayedSqliteFiles = [...sqliteFiles].sort((a, b) =>
    Number(b.source === 'd1-local') - Number(a.source === 'd1-local') ||
    a.path.localeCompare(b.path)
  );

  return (
    <div className="connections-page flex min-h-screen flex-col bg-bg">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-5 sm:px-10">
        <div className="flex min-w-0 items-center gap-3">
          <img src="/logo.svg" alt="" width={28} height={28} className="shrink-0" />
          <span className="text-base font-bold tracking-tight text-primary">JustDB</span>
          <span className="hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
          <span className="hidden truncate text-xs text-secondary sm:block">Just your data, no bullshit.</span>
        </div>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('justdb:open-settings'))}
          className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border text-secondary hover:bg-bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          title="Settings"
          aria-label="Settings"
        >
          <Settings className="size-5" strokeWidth={1.5} />
        </button>
      </header>
      <main className="w-full flex-1 px-5 pb-10 pt-12 sm:px-8 lg:pt-14">
        <div className="mx-auto w-full max-w-6xl">
            <div className="connection-intro mx-auto mb-8 max-w-xl">
              <p className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted">Your workspace</p>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                <h1 className="text-2xl font-semibold tracking-tight text-primary">Connect to a database</h1>
              {view === 'saved' ? (
                <Button type="button" variant="primary" onClick={() => setView('new')}>
                  <span className="inline-flex items-center gap-2"><Plus className="size-4" aria-hidden="true" />New connection</span>
                </Button>
              ) : (
                <button type="button" onClick={() => setView('saved')} className="inline-flex min-h-9 items-center gap-2 rounded-md px-2 text-sm font-medium text-secondary hover:bg-bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                  <ArrowLeft className="size-4" aria-hidden="true" />Saved and local
                </button>
              )}
              </div>
              <p className="mt-3 text-sm text-secondary">Jump back into a saved connection, or open a new one.</p>
            </div>

            <div className="connection-stage mx-auto max-w-xl">
            <AnimatedViews active={view}>
            <div data-active={view === 'saved'} aria-hidden={view !== 'saved'} inert={view !== 'saved'} className="space-y-4">
                <SavedConnections />
                <section className="rounded-xl border border-border bg-bg-secondary/20 px-5 py-5" aria-label="Detected local databases">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-primary">Local databases</h2>
                    <div className="flex flex-wrap items-center gap-2">
                      {localDbType === 'sqlite' && <button type="button" onClick={() => void chooseSqliteFolder()} disabled={sqliteScanning}
                        className="min-h-9 rounded-md px-2 text-sm text-secondary hover:bg-bg-secondary hover:text-primary disabled:opacity-50">Choose folder…</button>}
                      <button type="button" onClick={() => void (localDbType === 'sqlite' ? scanSqlite(sqliteFolder) : scanLocal())}
                        disabled={localDbType === 'sqlite' ? sqliteScanning : scanning}
                        className="flex min-h-9 items-center gap-1.5 rounded-md px-2 text-sm text-secondary hover:bg-bg-secondary hover:text-primary disabled:opacity-50"
                        aria-label="Scan again">
                        <RefreshCw className={`size-3.5 ${(localDbType === 'sqlite' ? sqliteScanning : scanning) ? 'animate-spin' : ''}`} strokeWidth={1.5} />Rescan
                      </button>
                    </div>
                  </div>
                  <div className="mb-3 flex w-fit rounded-md border border-border bg-bg p-0.5" role="group" aria-label="Local database type">
                    {(['postgresql', 'sqlite'] as const).map(kind => <button key={kind} type="button" aria-pressed={localDbType === kind}
                      onClick={() => setLocalDbType(kind)}
                      className={`min-h-8 rounded px-3 text-sm ${localDbType === kind ? 'bg-accent/15 font-medium text-primary' : 'text-secondary hover:text-primary'}`}>
                      {kind === 'postgresql' ? 'PostgreSQL' : 'SQLite'}
                    </button>)}
                  </div>
                  {localDbType === 'sqlite' ? (
                    <>
                      {sqliteFiles.length > 0 ? (
                        <div className="max-h-[28rem] overflow-y-auto divide-y divide-border border-t border-border">
                          {displayedSqliteFiles.map((file) => (
                            <div key={file.path} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-4">
                              <div className="flex min-w-0 flex-1 basis-48 items-center gap-3">
                                <ConnectorBadge kind={file.source === 'd1-local' ? 'd1' : 'sqlite'} />
                                <div className="min-w-0 flex-1">
                                  <p className="break-words text-sm font-medium text-primary">{file.source === 'd1-local' ? file.project ?? file.name : file.name}</p>
                                  <p className="mt-1 break-all font-mono text-meta leading-relaxed text-muted" title={file.path}>{localPathLabel(file.path, sqliteFiles.map(item => item.path))}</p>
                                  {file.source === 'd1-local' && <p className="mt-1 text-meta text-muted">D1 local · Read-only</p>}
                                </div>
                              </div>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="shrink-0"
                                aria-label={`Set up connection for ${file.project ?? file.name} at ${file.path}`}
                                onClick={() => useSqliteFile(file)}
                              >
                                Set up connection
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted">
                          {sqliteScanning || !sqliteScanStarted.current ? 'Looking for SQLite and local D1 files…' : sqliteScanError
                            ? 'Could not scan these folders.'
                            : 'No SQLite or local D1 files found in common folders.'}
                        </p>
                      )}
                      {sqliteScanError && sqliteFiles.length > 0 && (
                        <p className="mt-2 text-xs text-muted">Refresh failed; showing the previous results.</p>
                      )}

                    </>
                  ) : detected.length > 0 ? (
                    <div className="divide-y divide-border border-t border-border">
                      {detected.map((instance) => (
                        <div key={`${instance.host}:${instance.port}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-4">
                          <div className="flex min-w-0 flex-1 basis-48 items-center gap-3">
                            <ConnectorBadge kind="postgresql" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-primary">PostgreSQL</p>
                              <p className="mt-1 break-all text-meta font-mono text-muted">{instance.host}:{instance.port}</p>
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="shrink-0"
                            aria-label={`Set up connection for PostgreSQL at ${instance.host}:${instance.port}`}
                            onClick={() => useDetected(instance)}
                          >
                            Set up connection
                          </Button>
                        </div>
                      ))}
                      <p className="pt-3 text-xs text-muted">Saved details are reused when available. Check the suggested values before connecting.</p>
                      {scanError && <p className="text-xs text-muted">Refresh failed; showing the previous results.</p>}
                    </div>
                  ) : scanning ? (
                    <p className="text-xs text-muted">Checking local PostgreSQL ports…</p>
                  ) : scanError ? (
                    <p className="text-xs text-muted">Could not scan local databases. Try again in the desktop app.</p>
                  ) : (
                    <p className="text-xs text-muted">No PostgreSQL server found on common local ports. You can still enter a connection manually.</p>
                  )}
                </section>
            </div>
            <div data-active={view === 'new'} aria-hidden={view !== 'new'} inert={view !== 'new'}>
              <ConnectionForm
                onConnect={handleConnect}
                onConnectSaved={handleConnectSaved}
                onDbTypeChange={(type) => {
                  if (type === 'postgresql' || type === 'sqlite') setLocalDbType(type);
                }}
                isConnecting={isConnecting}
                onCancel={cancelConnect}
                detectedConnection={selected}
                detectedSqlite={selectedSqlite}
              />
            </div>
            </AnimatedViews>
            </div>

            {error && (
              <div className="mt-4 p-3 bg-danger/10 border border-danger/20 rounded-md text-danger text-sm">
                {error}
              </div>
            )}

        </div>
      </main>
      <footer className="border-t border-border px-5 py-5 text-center text-meta text-muted">
        Built by <a href="https://kreativekorna.com" target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">KreativeKorna Concepts</a>
      </footer>
    </div>
  );
}

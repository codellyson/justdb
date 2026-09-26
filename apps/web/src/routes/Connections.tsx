import { useCallback, useEffect, useRef, useState } from 'react';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { useConnection } from '../contexts/connection-context';
import { ConnectionForm } from '../components/connection-form';
import { SavedConnections } from '../components/saved-connections';
import { Button } from '../components/ui/button';
import type { DBConfig } from '../types';
import { db, type LocalDatabase, type LocalSqliteFile } from '../lib/db';
import { sqliteDisplayName } from '../lib/connection-url';
import { ArrowLeft, ArrowRight, Plus, RefreshCw, Settings } from 'lucide-react';
import { ConnectorLogo } from '../components/connector-logo';

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
    <div className="flex min-h-screen flex-col bg-bg">
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
            <div className="mx-auto mb-8 flex max-w-xl flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">Connect to a database</h1>
                <p className="mt-2 text-sm text-secondary">Jump back into a saved connection, or open a new one.</p>
              </div>
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

            <div hidden={view !== 'saved'} className="mx-auto max-w-xl space-y-4">
                <SavedConnections />
                <section className="rounded-xl border border-dashed border-border bg-bg-secondary/20 px-5 py-5" aria-label="Detected local databases">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-primary">
                      <span className="size-2 rounded-full bg-emerald-400" aria-hidden="true" />
                      Running on this machine
                    </h2>
                    <div className="flex items-center gap-2">
                      <div className="flex rounded-md border border-border bg-bg p-0.5" role="group" aria-label="Local database type">
                        {(['postgresql', 'sqlite'] as const).map((kind) => (
                          <button
                            key={kind}
                            type="button"
                            aria-pressed={localDbType === kind}
                            onClick={() => setLocalDbType(kind)}
                            className={`min-h-7 rounded px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${localDbType === kind ? 'bg-accent/15 font-medium text-accent' : 'text-secondary hover:text-primary'}`}
                          >
                            {kind === 'postgresql' ? 'PostgreSQL' : 'SQLite'}
                          </button>
                        ))}
                      </div>
                      <button
                      type="button"
                      onClick={() => void (localDbType === 'sqlite' ? scanSqlite(sqliteFolder) : scanLocal())}
                      disabled={localDbType === 'sqlite' ? sqliteScanning : scanning}
                      className="flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs text-secondary hover:bg-bg-secondary hover:text-primary disabled:opacity-50"
                      aria-label="Scan again"
                      title="Scan again"
                    >
                      <RefreshCw className={`size-3.5 ${(localDbType === 'sqlite' ? sqliteScanning : scanning) ? 'animate-spin' : ''}`} strokeWidth={1.5} />
                      Rescan
                    </button>
                    </div>
                  </div>
                  {localDbType === 'sqlite' ? (
                    <>
                      {sqliteFiles.length > 0 ? (
                        <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
                          {displayedSqliteFiles.map((file) => (
                            <div key={file.path} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-secondary px-3 py-2.5">
                              <div className="min-w-0">
                                <p className="flex items-center gap-1.5 truncate text-sm font-medium text-primary" title={file.name}>
                                  <ConnectorLogo kind={file.source === 'd1-local' ? 'd1' : 'sqlite'} className="size-4 shrink-0" />
                                  {file.source === 'd1-local' ? `D1 local · ${file.project ?? 'project'}` : file.name}
                                </p>
                                <p className="text-[11px] font-mono text-muted truncate" title={file.path}>{file.path}</p>
                              </div>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => useSqliteFile(file)}
                              >
                                <span className="inline-flex items-center gap-1">Use <ArrowRight className="size-3" aria-hidden="true" /></span>
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
                      {sqliteFiles.some((file) => file.source === 'd1-local') && (
                        <p className="mt-2 text-[11px] text-muted">Local D1 state is separate from Cloudflare's remote database and opens read-only.</p>
                      )}
                      {sqliteScanError && sqliteFiles.length > 0 && (
                        <p className="mt-2 text-xs text-muted">Refresh failed; showing the previous results.</p>
                      )}
                      <button
                        type="button"
                        onClick={() => void chooseSqliteFolder()}
                        disabled={sqliteScanning}
                        className="mt-3 text-xs font-medium text-accent hover:underline disabled:opacity-50"
                      >
                        Choose folder…
                      </button>
                    </>
                  ) : detected.length > 0 ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {detected.map((instance) => (
                        <div key={instance.port} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-secondary px-3 py-2.5">
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 text-sm font-medium text-primary"><ConnectorLogo kind="postgresql" className="size-4" />PostgreSQL</p>
                            <p className="text-[11px] font-mono text-muted">{instance.host}:{instance.port}</p>
                          </div>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => useDetected(instance)}
                          >
                            <span className="inline-flex items-center gap-1">Use <ArrowRight className="size-3" aria-hidden="true" /></span>
                          </Button>
                        </div>
                      ))}
                      <p className="col-span-full pt-1 text-[11px] text-muted">Saved details are reused when available. Check the suggested values before connecting.</p>
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
            <div hidden={view !== 'new'} className="mx-auto max-w-xl">
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

            {error && (
              <div className="mt-4 p-3 bg-danger/10 border border-danger/20 rounded-md text-danger text-sm">
                {error}
              </div>
            )}

        </div>
      </main>
      <footer className="border-t border-border px-5 py-5 text-center text-[11px] text-muted">
        Built by <a href="https://kreativekorna.com" target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">KreativeKorna Concepts</a>
      </footer>
    </div>
  );
}

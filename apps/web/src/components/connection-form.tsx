
import React, { useEffect, useState } from 'react';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { DBConfig } from '@/types';
import { db, type D1Database } from '@/lib/db';
import { parseConnectionURL, isConnectionURL, sqliteDisplayName } from '@/lib/connection-url';
import { Input as JustInput, Switch } from '@codellyson/justui/react';
import { ArrowRight, Check, FolderOpen, Search } from 'lucide-react';
import { ConnectorLogo } from './connector-logo';

type InputMode = 'url' | 'fields';
type DbType = 'postgresql' | 'mysql' | 'sqlite' | 'd1';

interface ConnectionFormProps {
  onConnect: (config: DBConfig, name?: string) => void;
  onConnectSaved: (id: string) => void;
  onDbTypeChange: (type: DbType) => void;
  isConnecting: boolean;
  onCancel?: () => void;
  detectedConnection?: {
    selection: number;
    config: DBConfig;
    name: string;
    savedConnectionId?: string;
  };
  detectedSqlite?: { path: string; name: string; readOnly: boolean; selection: number };
}

export const ConnectionForm: React.FC<ConnectionFormProps> = ({
  onConnect,
  onConnectSaved,
  onDbTypeChange,
  isConnecting,
  onCancel,
  detectedConnection,
  detectedSqlite,
}) => {
  const [dbType, setDbType] = useState<DbType>('postgresql');
  const [mode, setMode] = useState<InputMode>('url');
  const [connectionUrl, setConnectionUrl] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5432');
  const [database, setDatabase] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [useSSL, setUseSSL] = useState(true);
  const [connectionName, setConnectionName] = useState('');
  const [saveConnection, setSaveConnection] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [filepath, setFilepath] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [isPickingFile, setIsPickingFile] = useState(false);
  const [readOnlyLocal, setReadOnlyLocal] = useState(false);
  const [d1AccountId, setD1AccountId] = useState('');
  const [d1DatabaseId, setD1DatabaseId] = useState('');
  const [d1Databases, setD1Databases] = useState<D1Database[]>([]);
  const [d1Loading, setD1Loading] = useState(false);
  const [d1Error, setD1Error] = useState('');
  const [d1Loaded, setD1Loaded] = useState(false);
  const [d1Search, setD1Search] = useState('');
  const [d1Manual, setD1Manual] = useState(false);

  const selectedD1 = d1Databases.find((item) => item.uuid === d1DatabaseId.trim());
  const visibleD1Databases = d1Databases.filter((item) =>
    item.name.toLowerCase().includes(d1Search.trim().toLowerCase())
  );
  const d1ConnectionName = selectedD1?.name || (d1DatabaseId.trim()
    ? d1DatabaseId.trim().slice(0, 8)
    : '');

  useEffect(() => {
    if (!detectedConnection) return;
    const { config, name } = detectedConnection;
    setDbType('postgresql');
    setMode('fields');
    setHost(config.host);
    setPort(String(config.port));
    setDatabase(config.database);
    setUsername(config.username);
    setPassword('');
    setUseSSL(config.ssl ?? false);
    setConnectionName(name);
    setSaveConnection(true);
    setConnectionUrl('');
    setErrors({});
  }, [detectedConnection]);

  useEffect(() => {
    if (!detectedSqlite) return;
    setDbType('sqlite');
    setMode('fields');
    setConnectionUrl('');
    setFilepath(detectedSqlite.path);
    setUploadedFileName('');
    setAuthToken('');
    setConnectionName(detectedSqlite.name);
    setReadOnlyLocal(detectedSqlite.readOnly);
    setSaveConnection(true);
    setErrors({});
  }, [detectedSqlite]);

  const useSavedCredential = Boolean(
    detectedConnection?.savedConnectionId &&
    mode === 'fields' && dbType === 'postgresql' &&
    host === detectedConnection.config.host &&
    port === String(detectedConnection.config.port) &&
    database === detectedConnection.config.database &&
    username === detectedConnection.config.username &&
    useSSL === (detectedConnection.config.ssl ?? false) &&
    password === '' &&
    saveConnection && connectionName === detectedConnection.name
  );

  const handlePickFile = async () => {
    setIsPickingFile(true);
    setErrors((prev) => { const next = { ...prev }; delete next.filepath; return next; });
    try {
      const selected = await openFileDialog({
        multiple: false,
        directory: false,
        filters: [
          { name: 'SQLite database', extensions: ['db', 'sqlite', 'sqlite3', 's3db'] },
        ],
      });
      if (typeof selected === 'string' && selected) {
        setFilepath(selected);
        setUploadedFileName(selected.split('/').pop() || selected);
        setReadOnlyLocal(false);
      }
    } catch (err: any) {
      setErrors((prev) => ({ ...prev, filepath: err?.message || 'Could not open file picker' }));
    } finally {
      setIsPickingFile(false);
    }
  };

  const handleDbTypeChange = (type: DbType) => {
    if ((type === 'd1') !== (dbType === 'd1')) setAuthToken('');
    setDbType(type);
    onDbTypeChange(type);
    setMode(type === 'postgresql' ? 'url' : 'fields');
    setErrors({});
    if (type === 'sqlite') {
      setPort('0');
    } else {
      setPort(type === 'mysql' ? '3306' : '5432');
    }
  };

  const findD1Databases = async () => {
    setD1Error('');
    if (!/^[0-9a-fA-F]{32}$/.test(d1AccountId.trim()) || !authToken.trim()) {
      setD1Error('Enter your 32-character account ID and API token first.');
      return;
    }
    setD1Loading(true);
    try {
      const databases = await db.listD1Databases(d1AccountId.trim(), authToken.trim());
      setD1Databases(databases);
      setD1DatabaseId('');
      setD1Search('');
      setD1Manual(false);
      setD1Loaded(true);
      setErrors({});
    } catch (error) {
      setD1Error(String(error));
    } finally {
      setD1Loading(false);
    }
  };

  const parseUrl = (url: string) => {
    setConnectionUrl(url);
    if (!url.trim()) return;

    try {
      if (isConnectionURL(url)) {
        const parsed = parseConnectionURL(url);
        setDbType(parsed.type);
        onDbTypeChange(parsed.type);
        if (parsed.type === 'sqlite') {
          setFilepath(parsed.filepath || '');
          setReadOnlyLocal(false);
          if (parsed.authToken) setAuthToken(parsed.authToken);
        } else {
          setHost(parsed.host);
          setPort(String(parsed.port));
          setDatabase(parsed.database);
          setUsername(parsed.username);
          setPassword(parsed.password);
          if (parsed.ssl !== undefined) {
            setUseSSL(parsed.ssl !== false);
          }
        }
        setErrors((prev) => {
          const next = { ...prev };
          delete next.connectionUrl;
          return next;
        });
      }
    } catch (err: any) {
      setErrors((prev) => ({ ...prev, connectionUrl: err.message }));
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (dbType === 'd1') {
      if (!/^[0-9a-fA-F]{32}$/.test(d1AccountId.trim())) newErrors.d1AccountId = 'Enter a valid 32-character account ID';
      if (!/^[0-9a-fA-F-]{36}$/.test(d1DatabaseId.trim())) newErrors.d1DatabaseId = 'Select or enter a D1 database UUID';
      if (!authToken.trim()) newErrors.authToken = 'API token is required';
    } else if (dbType === 'sqlite') {
      if (mode === 'url') {
        if (!connectionUrl.trim()) {
          newErrors.connectionUrl = 'Connection URL is required';
        } else if (!isConnectionURL(connectionUrl)) {
          newErrors.connectionUrl = 'Invalid URL format. Use libsql://dbname.turso.io or sqlite:///path/to/db';
        }
      } else {
        if (!filepath.trim()) {
          newErrors.filepath = 'URL or file path is required';
        }
      }
    } else if (mode === 'url') {
      if (!connectionUrl.trim()) {
        newErrors.connectionUrl = 'Connection URL is required';
      } else if (!isConnectionURL(connectionUrl)) {
        newErrors.connectionUrl = 'Invalid URL format. Use postgresql:// or mysql://user:pass@host:port/db';
      } else {
        try {
          parseConnectionURL(connectionUrl);
        } catch (err: any) {
          newErrors.connectionUrl = err.message;
        }
      }
    } else {
      if (!host.trim()) newErrors.host = 'Host is required';
      if (!port.trim()) {
        newErrors.port = 'Port is required';
      } else if (isNaN(Number(port)) || Number(port) < 1 || Number(port) > 65535) {
        newErrors.port = 'Port must be between 1 and 65535';
      }
      if (!database.trim()) newErrors.database = 'Database name is required';
      if (!username.trim()) newErrors.username = 'Username is required';
    }

    if (saveConnection && dbType !== 'd1' && !connectionName.trim()) {
      newErrors.connectionName = 'Connection name is required when saving';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    if (useSavedCredential && detectedConnection?.savedConnectionId) {
      onConnectSaved(detectedConnection.savedConnectionId);
      return;
    }

    let config: DBConfig;

    if (dbType === 'd1') {
      config = {
        host: 'localhost',
        port: 0,
        database: selectedD1?.name || d1DatabaseId.trim(),
        username: '',
        password: '',
        type: 'sqlite',
        filepath: `d1://${d1AccountId.trim()}/${d1DatabaseId.trim()}`,
        authToken: authToken.trim(),
      };
    } else if (dbType === 'sqlite') {
      let resolvedPath = filepath.trim();
      let token = authToken.trim();
      if (mode === 'url') {
        const parsed = parseConnectionURL(connectionUrl);
        resolvedPath = parsed.filepath || '';
        token = parsed.authToken || token;
      }
      const dbName = sqliteDisplayName(resolvedPath);
      config = {
        host: 'localhost',
        port: 0,
        database: dbName,
        username: '',
        password: '',
        type: 'sqlite',
        filepath: resolvedPath,
        authToken: token || undefined,
        readOnly: readOnlyLocal && mode === 'fields' && resolvedPath === detectedSqlite?.path,
      };
    } else if (mode === 'url') {
      const parsed = parseConnectionURL(connectionUrl);
      // Rust's DbConfig declares `ssl: bool`. URL-derived ssl wins when
      // explicit (sslmode=require|disable); otherwise fall back to the
      // form's "Use SSL" checkbox.
      const sslOn = parsed.ssl ?? useSSL;
      config = {
        host: parsed.host,
        port: parsed.port,
        database: parsed.database,
        username: parsed.username,
        password: parsed.password,
        ssl: sslOn,
        type: parsed.type,
      };
    } else {
      config = {
        host: host.trim(),
        port: Number(port),
        database: database.trim(),
        username: username.trim(),
        password: password,
        ssl: useSSL,
        type: dbType,
      };
    }

    const name = saveConnection
      ? (dbType === 'd1' ? `D1 · ${d1ConnectionName}` : connectionName.trim())
      : undefined;
    onConnect(config, name);
  };

  const urlPlaceholder = dbType === 'sqlite'
    ? 'libsql://dbname.turso.io  or  sqlite:///path/to/file.db'
    : dbType === 'mysql'
      ? 'mysql://user:password@localhost:3306/mydb'
      : 'postgresql://user:password@localhost:5432/mydb';

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-bg-secondary/50">
      <div className="flex min-h-16 items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h3 className="text-sm font-semibold text-primary">New connection</h3>
        {dbType !== 'd1' && <div className="flex shrink-0 rounded-lg border border-border bg-bg p-1">
          <button
            type="button"
            onClick={() => setMode('url')}
            className={`min-h-8 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              mode === 'url'
                ? 'bg-accent/15 text-accent'
                : 'text-secondary hover:text-primary hover:bg-bg-secondary'
            }`}
          >
            {dbType === 'sqlite' ? 'Remote URL' : 'URL'}
          </button>
          <button
            type="button"
            onClick={() => setMode('fields')}
            className={`min-h-8 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              mode === 'fields'
                ? 'bg-accent/15 text-accent'
                : 'text-secondary hover:text-primary hover:bg-bg-secondary'
            }`}
          >
            {dbType === 'sqlite' ? 'Local file' : 'Fields'}
          </button>
        </div>}
      </div>
      <div className="grid grid-cols-3 gap-2 px-5 pt-4" role="group" aria-label="Database connector">
        {([
          { type: 'postgresql', label: 'PostgreSQL' },
          { type: 'sqlite', label: 'SQLite' },
          { type: 'd1', label: 'Cloudflare D1' },
        ] as const).map((connector) => (
          <button
            key={connector.type}
            type="button"
            aria-pressed={dbType === connector.type}
            onClick={() => handleDbTypeChange(connector.type)}
            className={`flex min-h-16 min-w-0 flex-col items-start justify-between rounded-lg border px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:px-3 ${
              dbType === connector.type
                ? 'border-accent bg-accent/10 text-primary'
                : 'border-border bg-bg text-secondary hover:bg-bg-secondary hover:text-primary'
            }`}
          >
            <ConnectorLogo kind={connector.type} className="size-6" />
            <span className="mt-2 truncate text-xs font-semibold">{connector.label}</span>
          </button>
        ))}
      </div>
      <div className="px-5 pt-2 text-right">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('justdb:open-settings', { detail: { tab: 'connectors' } }))}
          className="min-h-8 text-xs font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Manage connectors
        </button>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4 p-5">
        {dbType === 'd1' ? (
          <div className="space-y-3">
            {d1Loaded ? (
              <>
                <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg-secondary px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-primary">Cloudflare account</p>
                    <p className="font-mono text-[11px] text-muted truncate">{d1AccountId.slice(0, 8)}…{d1AccountId.slice(-4)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setD1Loaded(false); setD1DatabaseId(''); setD1Manual(false); }}
                    disabled={isConnecting}
                    className="min-h-8 shrink-0 rounded-md px-3 text-xs font-medium text-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                  >
                    Change
                  </button>
                </div>
                {!d1Manual && (
                  <>
                    <div>
                      <label htmlFor="d1-search" className="block text-xs font-medium text-secondary mb-1.5">
                        Choose a database <span className="font-normal text-muted">({d1Databases.length})</span>
                      </label>
                      <div className="relative">
                        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" strokeWidth={1.5} />
                        <JustInput
                          id="d1-search"
                          type="search"
                          value={d1Search}
                          onChange={(value) => { setD1Search(value); setD1DatabaseId(''); setErrors({}); }}
                          placeholder="Search databases"
                          disabled={isConnecting}
                          containerClassName="w-full"
                          className="pl-9"
                        />
                      </div>
                    </div>
                    <div className="max-h-72 overflow-y-auto rounded-md border border-border" role="group" aria-label="Cloudflare D1 databases">
                      {visibleD1Databases.length > 0 ? visibleD1Databases.map((item) => (
                        <button
                          key={item.uuid}
                          type="button"
                          aria-pressed={d1DatabaseId === item.uuid}
                          onClick={() => { setD1DatabaseId(item.uuid); setErrors({}); }}
                          disabled={isConnecting}
                          className={`flex min-h-12 w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent disabled:opacity-50 ${d1DatabaseId === item.uuid ? 'bg-accent/10 text-accent' : 'text-primary hover:bg-bg-secondary'}`}
                        >
                          <span className="min-w-0 truncate text-sm font-medium">{item.name}</span>
                          <Check
                            aria-hidden="true"
                            className={`size-4 shrink-0 ${d1DatabaseId === item.uuid ? 'opacity-100' : 'opacity-0'}`}
                            strokeWidth={2}
                          />
                        </button>
                      )) : (
                        <p className="px-3 py-5 text-center text-xs text-muted">
                          {d1Databases.length === 0 ? 'No D1 databases found in this account.' : 'No databases match your search.'}
                        </p>
                      )}
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <Input
                  label="Cloudflare account ID"
                  value={d1AccountId}
                  onChange={(value) => { setD1AccountId(value); setD1DatabaseId(''); setD1Databases([]); setD1Error(''); setErrors({}); }}
                  placeholder="32-character account ID"
                  error={errors.d1AccountId}
                  disabled={isConnecting}
                />
                <Input
                  label="API token"
                  type="password"
                  value={authToken}
                  onChange={(value) => { setAuthToken(value); setD1Databases([]); setD1Error(''); setErrors({}); }}
                  placeholder="Token with D1 Read or D1 Write permission"
                  error={errors.authToken}
                  disabled={isConnecting}
                />
                <Button type="button" variant="primary" className="w-full transition-transform duration-150 ease-out active:scale-[0.96]" onClick={() => void findD1Databases()} disabled={isConnecting || d1Loading}>
                  {d1Loading ? 'Finding databases…' : 'Show databases'}
                </Button>
                {d1Error && <p className="text-xs text-danger" role="alert">{d1Error}</p>}
              </>
            )}
            {d1Manual && (
              <Input
                label="Database ID"
                value={d1DatabaseId}
                onChange={(value) => { setD1DatabaseId(value); setErrors({}); }}
                placeholder="D1 database UUID"
                error={errors.d1DatabaseId}
                disabled={isConnecting}
              />
            )}
            <button
              type="button"
              onClick={() => { setD1Manual(!d1Manual); setD1DatabaseId(''); setD1Error(''); setErrors({}); }}
              className="inline-flex min-h-8 items-center text-xs font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {d1Manual ? (d1Loaded ? 'Choose from the list' : 'Hide database ID') : 'Enter database ID manually'}
            </button>
            {errors.d1DatabaseId && !d1Manual && <p className="text-xs text-danger" role="alert">Choose a database to connect.</p>}
          </div>
        ) : mode === 'url' ? (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-secondary">Connection URL</label>
            <JustInput
              value={connectionUrl}
              onChange={parseUrl}
              placeholder={urlPlaceholder}
              disabled={isConnecting}
              containerClassName="w-full"
              className="font-mono"
            />
            {errors.connectionUrl && (
              <p className="mt-1 text-xs text-danger">{errors.connectionUrl}</p>
            )}
            {!errors.connectionUrl && <p className="mt-2 text-xs text-muted">{dbType === 'sqlite' ? 'Paste a libSQL or Turso URL.' : 'Paste a full connection string, for example from Railway or Supabase.'}</p>}
            {dbType !== 'sqlite' && connectionUrl && !errors.connectionUrl && isConnectionURL(connectionUrl) && (
              <p className="mt-1 text-xs font-mono text-muted">
                {host}:{port}/{database} as {username}
              </p>
            )}
            {dbType === 'sqlite' && /^libsql:\/\//i.test(connectionUrl.trim()) && (
              <div className="mt-3">
                <label className="block text-xs font-medium text-secondary mb-1">
                  Auth token
                </label>
                <JustInput
                  type="password"
                  withPasswordToggle
                  value={authToken}
                  onChange={setAuthToken}
                  placeholder="eyJhbGciOi… (required for Turso unless embedded in the URL via ?authToken=…)"
                  disabled={isConnecting}
                  containerClassName="w-full"
                  className="font-mono"
                />
              </div>
            )}
          </div>
        ) : dbType === 'sqlite' ? (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">
                SQLite file
              </label>
              <div className="flex gap-2">
                <JustInput
                  value={uploadedFileName || filepath}
                  onChange={(v) => { setFilepath(v); setUploadedFileName(''); setReadOnlyLocal(false); }}
                  placeholder="/path/to/database.sqlite"
                  disabled={isConnecting || isPickingFile}
                  containerClassName="flex-1"
                  className="font-mono"
                />
                <button
                  type="button"
                  onClick={handlePickFile}
                  disabled={isConnecting || isPickingFile}
                  className="inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-md border border-border px-3 py-2 text-xs font-medium text-secondary hover:bg-bg-secondary hover:text-primary disabled:opacity-50"
                >
                  <FolderOpen className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
                  {isPickingFile ? 'Choosing...' : 'Choose file'}
                </button>
              </div>
              {errors.filepath && (
                <p className="mt-1 text-xs text-danger">{errors.filepath}</p>
              )}
              {uploadedFileName && !errors.filepath && (
                <p className="mt-1 text-xs text-muted break-all">
                  Uploaded: {uploadedFileName}
                </p>
              )}
              {readOnlyLocal && (
                <p className="mt-1 text-xs text-muted">Local D1 state opens read-only. Use Wrangler for changes.</p>
              )}
            </div>
            <p className="text-xs text-muted">Choose a local file, or switch to Remote URL for libSQL and Turso.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <Input
                label="Host"
                type="text"
                value={host}
                onChange={setHost}
                placeholder="localhost"
                error={errors.host}
                disabled={isConnecting}
              />
              <Input
                label="Port"
                inputMode="numeric"
                value={port}
                onChange={setPort}
                placeholder="5432"
                error={errors.port}
                disabled={isConnecting}
              />
            </div>
            <Input
              label="Database"
              type="text"
              value={database}
              onChange={setDatabase}
              placeholder="mydb"
              error={errors.database}
              disabled={isConnecting}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Username"
                type="text"
                value={username}
                onChange={setUsername}
                placeholder="postgres"
                error={errors.username}
                disabled={isConnecting}
              />
              <Input
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                placeholder={useSavedCredential ? 'Stored in keychain' : '••••••••'}
                error={errors.password}
                disabled={isConnecting}
              />
            </div>
            {useSavedCredential && (
              <p className="text-xs text-muted">The saved password will be used when you connect.</p>
            )}
          </>
        )}
        {(dbType !== 'd1' || d1Loaded || d1Manual) && <div className="overflow-hidden rounded-lg border border-border bg-bg">
          {dbType !== 'sqlite' && dbType !== 'd1' && (
            <div className="flex items-center justify-between gap-3 px-3.5 py-3">
              <div>
                <p className="text-xs font-semibold text-primary">Require SSL</p>
                <p className="mt-0.5 text-[11px] text-muted">Recommended for remote hosts</p>
              </div>
              <Switch checked={useSSL} onChange={(checked) => setUseSSL(checked === true)} disabled={isConnecting} size="sm" aria-label="Require SSL" />
            </div>
          )}
          <div className={`flex items-center justify-between gap-3 px-3.5 py-3 ${dbType !== 'sqlite' && dbType !== 'd1' ? 'border-t border-border' : ''}`}>
            <div>
              <p className="text-xs font-semibold text-primary">Save this connection</p>
              <p className="mt-0.5 text-[11px] text-muted">Shows up under Saved connections</p>
            </div>
            <Switch checked={saveConnection} onChange={(checked) => setSaveConnection(checked === true)} disabled={isConnecting} size="sm" aria-label="Save this connection" />
          </div>
          {saveConnection && dbType !== 'd1' && (
            <div className="border-t border-border px-3.5 py-3">
              <Input
                label="Name"
                type="text"
                value={connectionName}
                onChange={setConnectionName}
                placeholder="e.g. Khaime Staging"
                error={errors.connectionName}
                disabled={isConnecting}
              />
            </div>
          )}
          {saveConnection && dbType === 'd1' && d1DatabaseId && (
            <p className="border-t border-border px-3.5 py-2 text-xs text-muted">Will be saved as D1 · {d1ConnectionName}</p>
          )}
        </div>}
        {(dbType !== 'd1' || d1Loaded || d1Manual) && <div className="flex gap-2 pt-1">
          <Button
            type="submit"
            variant="primary"
            className="min-h-11 flex-1 transition-transform duration-150 ease-out active:scale-[0.96]"
            isLoading={isConnecting}
            disabled={isConnecting || (dbType === 'd1' && !d1DatabaseId.trim())}
          >
            <span className="inline-flex items-center gap-2">{dbType === 'd1'
              ? (d1DatabaseId ? `Connect to ${d1ConnectionName}` : 'Select a database')
              : 'Connect'} <ArrowRight className="size-4" aria-hidden="true" /></span>
          </Button>
          {isConnecting && onCancel && (
            <Button
              type="button"
              variant="secondary"
              onClick={onCancel}
            >
              Cancel
            </Button>
          )}
        </div>}
      </form>
    </div>
  );
};

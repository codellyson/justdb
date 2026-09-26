import { providerForConfig, installedProviders } from '@/lib/connector-catalog';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { DBConfig, SavedConnection } from '@/types';
import { db } from '@/lib/db';
import { getIdleTimeoutMin } from '@/lib/app-settings';
import { track, toDbKind } from '@/lib/telemetry';
import { useToast } from './toast-context';

const ACTIVITY_THROTTLE_MS = 5_000;
const ACTIVITY_CHANNEL = 'justdb-activity';
const ACTIVITY_EVENTS: Array<keyof DocumentEventMap> = [
  'mousedown',
  'keydown',
  'scroll',
  'touchstart',
  'visibilitychange',
];

interface ConnectionContextType {
  isConnected: boolean;
  isConnecting: boolean;
  databaseName?: string;
  activeConnector?: ReturnType<typeof providerForConfig>;
  databaseType: "postgresql" | "mysql" | "sqlite";
  currentConnectionId?: string;
  savedConnections: SavedConnection[];
  connect: (config: DBConfig, name?: string) => Promise<void>;
  connectToSaved: (connectionId: string) => Promise<void>;
  cancelConnect: () => void;
  disconnect: () => Promise<void>;
  saveConnection: (name: string, config: DBConfig) => void;
  deleteConnection: (connectionId: string) => void;
  error: string | null;
}

const ConnectionContext = createContext<ConnectionContextType | undefined>(undefined);

const CURRENT_CONNECTION_KEY = 'db-current-connection';

export function ConnectionProvider({ children }: { children: React.ReactNode }) {
  const [activeConnector, setActiveConnector] = useState<ReturnType<typeof providerForConfig>>();
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [databaseName, setDatabaseName] = useState<string | undefined>();
  const [currentConnectionId, setCurrentConnectionId] = useState<string | undefined>();
  const [savedConnections, setSavedConnections] = useState<SavedConnection[]>([]);
  const [databaseType, setDatabaseType] = useState<"postgresql" | "mysql" | "sqlite">("postgresql");
  const [error, setError] = useState<string | null>(null);
  const { addToast } = useToast();
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef<number>(0);
  // Token bumped per connect attempt; cancelConnect bumps it too so the
  // resolving await sees a mismatch and discards its result. Tauri's
  // invoke() can't actually be aborted — we just make the UI behave as
  // if it were, and clean up the orphan session that does come back.
  const connectTokenRef = useRef(0);

  const loadSavedConnections = useCallback(async () => {
    try {
      const connections = await db.savedList();
      setSavedConnections(connections);
    } catch (e) {
      console.error('Failed to load saved connections:', e);
    }
  }, []);

  useEffect(() => {
    loadSavedConnections();
  }, [loadSavedConnections]);

  useEffect(() => {
    if (savedConnections.length > 0 && !isConnected) {
      const currentId = typeof window !== 'undefined'
        ? localStorage.getItem(CURRENT_CONNECTION_KEY)
        : null;
      if (currentId) {
        const connection = savedConnections.find(c => c.id === currentId);
        if (connection) {
          connectToSaved(currentId).catch(() => {});
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedConnections.length]);

  const connect = async (config: DBConfig, name?: string) => {
    const required = providerForConfig(config);
    if ((required === 'd1' || required === 'turso') && !installedProviders().includes(required)) {
      const message = `Install ${required === 'd1' ? 'Cloudflare D1' : 'Turso / libSQL'} in Settings → Connectors first.`;
      setError(message); throw new Error(message);
    }
    const token = ++connectTokenRef.current;
    setIsConnecting(true);
    setError(null);
    try {
      const connectionId = name
        ? `conn_${Date.now()}_${Math.random().toString(36).substring(7)}`
        : undefined;

      // Single call: opens the session + optionally writes to the OS keychain.
      const data = await db.connect(
        config,
        name && connectionId ? { name, id: connectionId } : undefined,
      );

      if (connectTokenRef.current !== token) {
        // Cancelled or superseded. Discard this session in the background.
        void db.disconnectId(data.sessionId);
        return;
      }

      setIsConnected(true);
      const connector = providerForConfig(config);
      setActiveConnector(connector);
      setDatabaseName(data.database || config.database);
      setDatabaseType((data.type || config.type || 'postgresql') as 'postgresql' | 'mysql' | 'sqlite');
      void track({ name: 'connection_opened', db_type: toDbKind(data.type || config.type), success: true });

      if (name && data.savedConnection) {
        setSavedConnections(prev => [...prev, data.savedConnection!]);
        setCurrentConnectionId(connectionId);
        localStorage.setItem(CURRENT_CONNECTION_KEY, connectionId!);
      }
    } catch (err: any) {
      if (connectTokenRef.current !== token) return;
      setError(err.message || 'Connection failed');
      setIsConnected(false);
      setDatabaseName(undefined);
      void track({ name: 'connection_opened', db_type: toDbKind(config.type), success: false });
      throw err;
    } finally {
      if (connectTokenRef.current === token) setIsConnecting(false);
    }
  };

  const connectToSaved = async (connectionId: string) => {
    const connection = savedConnections.find(c => c.id === connectionId);
    if (!connection) {
      throw new Error('Connection not found');
    }

    const required = providerForConfig(connection.config);
    if ((required === 'd1' || required === 'turso') && !installedProviders().includes(required)) {
      const message = `Install ${required === 'd1' ? 'Cloudflare D1' : 'Turso / libSQL'} in Settings → Connectors first.`;
      setError(message); throw new Error(message);
    }
    const token = ++connectTokenRef.current;
    setIsConnecting(true);
    setError(null);
    try {
      // Rust pulls the credentials from the OS keychain and opens a fresh session.
      const data = await db.connectSaved(connectionId);

      if (connectTokenRef.current !== token) {
        void db.disconnectId(data.sessionId);
        return;
      }

      setIsConnected(true);
      const connector = providerForConfig(connection.config);
      setActiveConnector(connector);
      setDatabaseName(data.database || connection.config.database);
      setDatabaseType((data.type || connection.config.type || 'postgresql') as 'postgresql' | 'mysql' | 'sqlite');
      void track({ name: 'connection_opened', db_type: toDbKind(data.type || connection.config.type), success: true });
      setCurrentConnectionId(connectionId);
      localStorage.setItem(CURRENT_CONNECTION_KEY, connectionId);

      setSavedConnections(prev =>
        prev.map(c =>
          c.id === connectionId ? { ...c, lastUsed: Date.now() } : c
        )
      );
    } catch (err: any) {
      if (connectTokenRef.current !== token) return;
      setError(err.message || 'Connection failed');
      setIsConnected(false);
      setDatabaseName(undefined);
      throw err;
    } finally {
      if (connectTokenRef.current === token) setIsConnecting(false);
    }
  };

  const cancelConnect = useCallback(() => {
    connectTokenRef.current += 1;
    setIsConnecting(false);
    setError(null);
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await db.disconnect();
      setIsConnected(false);
      setDatabaseName(undefined);
      setDatabaseType("postgresql");
      setActiveConnector(undefined);
      setCurrentConnectionId(undefined);
      if (typeof window !== 'undefined') {
        localStorage.removeItem(CURRENT_CONNECTION_KEY);
      }
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Disconnect failed');
      throw err;
    }
  }, []);

  useEffect(() => {
    if (!isConnected) {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      return;
    }

    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(ACTIVITY_CHANNEL)
        : null;

    const idleMin = getIdleTimeoutMin();
    const arm = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        void disconnect();
        addToast(`Disconnected after ${idleMin} minutes of inactivity`, 'info');
      }, idleMin * 60 * 1000);
    };

    const noteActivity = (broadcast: boolean) => {
      const now = Date.now();
      if (now - lastActivityRef.current < ACTIVITY_THROTTLE_MS) return;
      lastActivityRef.current = now;
      arm();
      if (broadcast && channel) channel.postMessage({ t: now });
    };

    lastActivityRef.current = Date.now();
    arm();

    const onLocalActivity = () => noteActivity(true);
    const onRemoteActivity = () => noteActivity(false);

    ACTIVITY_EVENTS.forEach((ev) =>
      document.addEventListener(ev, onLocalActivity, { passive: true })
    );
    if (channel) channel.addEventListener('message', onRemoteActivity);

    return () => {
      ACTIVITY_EVENTS.forEach((ev) => document.removeEventListener(ev, onLocalActivity));
      if (channel) {
        channel.removeEventListener('message', onRemoteActivity);
        channel.close();
      }
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [isConnected, disconnect, addToast]);

  const saveConnection = async (name: string, config: DBConfig) => {
    const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    try {
      const connection = await db.savedCreate(connectionId, name, config);
      setSavedConnections(prev => [...prev, connection]);
    } catch (e) {
      console.error('Failed to save connection:', e);
    }
  };

  const deleteConnection = async (connectionId: string) => {
    try {
      await db.savedDelete(connectionId);
      setSavedConnections(prev => prev.filter(c => c.id !== connectionId));
      if (currentConnectionId === connectionId) {
        disconnect();
      }
    } catch (e) {
      console.error('Failed to delete connection:', e);
    }
  };

  return (
    <ConnectionContext.Provider
      value={{
        activeConnector,
        isConnected,
        isConnecting,
        databaseName,
        databaseType,
        currentConnectionId,
        savedConnections,
        connect,
        connectToSaved,
        cancelConnect,
        disconnect,
        saveConnection,
        deleteConnection,
        error,
      }}
    >
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnection() {
  const context = useContext(ConnectionContext);
  if (context === undefined) {
    throw new Error('useConnection must be used within a ConnectionProvider');
  }
  return context;
}


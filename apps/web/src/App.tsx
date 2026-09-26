import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@codellyson/justui/react';
import { ToastProvider } from './contexts/toast-context';
import { ConnectionProvider } from './contexts/connection-context';
import { ThemeProvider } from './contexts/theme-context';
import { DashboardProvider } from './contexts/dashboard-context';
import { PendingChangesProvider } from './contexts/pending-changes-context';
import { ToastContainer } from './components/ui/toast';
import { UpdatePrompt } from './components/update-prompt';
import { SettingsModal, type SettingsTab } from './components/settings-modal';
import { TelemetryNotice } from './components/telemetry-notice';
import { Home } from './routes/Home';
import { Query } from './routes/Query';

// Settings can float or dock beside the workspace. The event keeps entry
// points in the header, AI bar, and disconnected view independent of layout.
function SettingsWorkspace() {
  const [open, setOpen] = useState(false);
  const [docked, setDocked] = useState(() => window.localStorage.getItem('justdb:settings-docked') !== 'false');
  const [initialTab, setInitialTab] = useState<SettingsTab | undefined>(undefined);
  useEffect(() => {
    const onOpen = (e: Event) => {
      const tab = (e as CustomEvent).detail?.tab;
      setInitialTab(
        ['ai', 'connectors', 'appearance', 'formatting', 'data', 'privacy'].includes(tab)
          ? tab as SettingsTab
          : undefined
      );
      setOpen(true);
    };
    window.addEventListener('justdb:open-settings', onOpen);
    return () => window.removeEventListener('justdb:open-settings', onOpen);
  }, []);
  useEffect(() => {
    if (!open || !docked) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [open, docked]);

  const toggleDock = () => {
    const next = !docked;
    window.localStorage.setItem('justdb:settings-docked', String(next));
    setDocked(next);
  };

  return (
    <>
      <div className={open && docked ? 'min-w-0 lg:mr-[460px]' : 'min-w-0'}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/query" element={<Query />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <SettingsModal
        isOpen={open}
        onClose={() => setOpen(false)}
        docked={docked}
        onToggleDock={toggleDock}
        initialTab={initialTab}
      />
    </>
  );
}

// Defaults match apps/next/app/providers.tsx — DashboardProvider's queries
// are user-driven (table data, schema), so we don't want focus/mount
// refetches stealing CPU mid-edit; staleTime keeps cached metadata around
// for the typical "tab away, come back" flow.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 10,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      retry: 1,
    },
  },
});

// Provider stack ordering:
//   ToastProvider          — sits outermost: ConnectionProvider dispatches
//                            toasts (idle disconnect), Dashboard does too.
//   ThemeProvider          — independent of connection, applies CSS vars to
//                            <html> on mount. Outside connection so the
//                            disconnected landing is themed too.
//   ConnectionProvider     — owns the active DB session + saved connections.
//   PendingChangesProvider — stages mutations until the user reviews them;
//                            owned per-connection but state is local to the
//                            session, so it lives inside ConnectionProvider.
//   DashboardProvider      — orchestrates the workspace (tables, schemas,
//                            tabs, etc). Reads connection state, so nests
//                            inside ConnectionProvider.
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={400}>
      <ToastProvider>
        <ThemeProvider>
          <ConnectionProvider>
            <PendingChangesProvider>
              <DashboardProvider>
                <SettingsWorkspace />
                <ToastContainer />
                <UpdatePrompt />
                <TelemetryNotice />
              </DashboardProvider>
            </PendingChangesProvider>
          </ConnectionProvider>
        </ThemeProvider>
      </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

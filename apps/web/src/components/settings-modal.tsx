import React, { useState, useEffect, useCallback } from 'react';
import { Modal } from './ui/modal';
import { Select } from './ui/select';
import { FormatterSettingsBody } from './formatter-settings';
import { ai, PROVIDERS, type AiStatus, type ProviderId, type LocalAgentInfo } from '@/lib/ai';
import { useTheme } from '../contexts/theme-context';
import {
  getResultRowCap, setResultRowCap, DEFAULT_ROW_CAP,
  getIdleTimeoutMin, setIdleTimeoutMin, DEFAULT_IDLE_MIN,
  getEditorLineNumbers, setEditorLineNumbers, EDITOR_SETTINGS_EVENT,
  getTelemetryEnabled, setTelemetryEnabled,
} from '@/lib/app-settings';
import { Check, LockKeyhole, Maximize2, PanelRightOpen, Sparkles, Trash2, X } from 'lucide-react';
import { Input, Switch } from '@codellyson/justui/react';
import { Button } from './ui';
import { ConnectorLogo, type ConnectorKind } from './connector-logo';
import { ConfirmDialog } from './ui/confirm-dialog';

export type SettingsTab = 'ai' | 'connectors' | 'appearance' | 'formatting' | 'data' | 'privacy';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  docked: boolean;
  onToggleDock: () => void;
  /** Tab to focus when the modal opens (e.g. deep-linked from a banner). */
  initialTab?: SettingsTab;
}

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'ai', label: 'AI' },
  { id: 'connectors', label: 'Connectors' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'formatting', label: 'Formatting' },
  { id: 'data', label: 'Data' },
  { id: 'privacy', label: 'Privacy' },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, docked, onToggleDock, initialTab }) => {
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? 'ai');
  useEffect(() => {
    if (isOpen && initialTab) setTab(initialTab);
  }, [isOpen, initialTab]);
  if (!isOpen) return null;

  const navigation = (
      <nav
        aria-label="Settings sections"
        className={docked
          ? 'flex shrink-0 gap-2 overflow-x-auto border-b border-border px-5 scrollbar-none'
          : 'flex w-36 shrink-0 flex-col gap-0.5 border-r border-border pr-5 py-4'}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => setTab(t.id)}
            className={docked
              ? `min-h-12 shrink-0 border-b-2 px-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${tab === t.id ? 'border-accent text-primary' : 'border-transparent text-muted hover:text-primary'}`
              : `min-h-8 rounded-md px-2.5 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              tab === t.id ? 'bg-accent/10 font-medium text-accent' : 'text-secondary hover:bg-bg-secondary hover:text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
        {!docked && <button
          type="button"
          onClick={onToggleDock}
          className="mt-auto flex min-h-9 items-center gap-2 rounded-md px-2.5 text-left text-xs text-secondary hover:bg-bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <PanelRightOpen className="size-4 shrink-0" strokeWidth={1.5} />
          Dock right
        </button>}
      </nav>
  );
  const content = (
      <div className={docked ? 'min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-6' : 'h-[min(60vh,520px)] min-w-0 flex-1 overflow-y-auto py-4 pr-1'}>
        {tab === 'ai' && <AiSection docked={docked} />}
        {tab === 'connectors' && <ConnectorsSection />}
        {tab === 'appearance' && <AppearanceSection />}
        {tab === 'formatting' && <FormatterSettingsBody />}
        {tab === 'data' && <DataSection />}
        {tab === 'privacy' && <PrivacySection />}
      </div>
  );

  if (docked) {
    return (
      <>
        <button
          type="button"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          aria-label="Close settings"
        />
        <aside aria-label="Settings" className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[460px] flex-col border-l border-border bg-bg shadow-xl lg:shadow-none">
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-5">
            <h2 className="text-xl font-semibold text-primary">Settings</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onToggleDock}
                className="flex size-9 items-center justify-center rounded-md text-secondary hover:bg-bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label="Float settings"
                title="Open settings in a window"
              >
                <Maximize2 className="size-4" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex size-9 items-center justify-center rounded-md text-secondary hover:bg-bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label="Close settings"
              >
                <X className="size-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>
          {navigation}
          {content}
        </aside>
      </>
    );
  }
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" width={768}>
      <div className="-my-4 flex gap-5">{navigation}{content}</div>
    </Modal>
  );
};

const ConnectorsSection: React.FC = () => (
  <div className="space-y-4">
    <div>
      <h3 className="text-sm font-semibold text-primary">Database connectors</h3>
      <p className="mt-1 text-xs text-muted">Connection types included with JustDB.</p>
    </div>
    <div className="space-y-2">
      {[
        { name: 'PostgreSQL', detail: 'Local and remote servers', kind: 'postgresql' },
        { name: 'SQLite', detail: 'Local files and libSQL', kind: 'sqlite' },
        { name: 'Cloudflare D1', detail: 'Local state and remote API', kind: 'd1' },
      ].map(({ name, detail, kind }) => (
        <div key={name} className="flex items-start gap-3 rounded-md border border-border px-3 py-2.5">
          <ConnectorLogo kind={kind as ConnectorKind} className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-primary">{name}</p>
            <p className="text-xs text-muted">{detail}</p>
          </div>
          <span className="shrink-0 rounded-full bg-bg-secondary px-2 py-0.5 text-[11px] text-secondary">Included</span>
        </div>
      ))}
    </div>
  </div>
);

// ─── AI ───────────────────────────────────────────────────────────────────

const AiSection: React.FC<{ docked: boolean }> = ({ docked }) => {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [provider, setProvider] = useState<ProviderId>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState(false);
  const [agents, setAgents] = useState<LocalAgentInfo[] | null>(null);
  const [checking, setChecking] = useState(false);

  const meta = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0];
  const isLocal = meta.local === true;
  const localAgent = agents?.find((a) => a.id === provider);
  // Detection is a best-effort path probe, so it must never be the only gate —
  // a false negative would otherwise lock the provider out entirely. Saving
  // undetected is allowed; the chat path re-resolves and errors clearly.
  const sameProvider = status?.configured && status.provider === provider;
  const hasChanges = status !== null && (!status.configured || !sameProvider || model.trim() !== (status.customModel ?? '').trim() || !!apiKey.trim());
  const canSave = hasChanges && (isLocal || !!apiKey.trim() || !!sameProvider);

  const refresh = useCallback(async () => {
    try {
      const s = await ai.status();
      setStatus(s);
      if (s.configured && s.provider && PROVIDERS.some((p) => p.id === s.provider)) {
        setProvider(s.provider as ProviderId);
        setModel(s.customModel ?? '');
      }
    } catch {
      setStatus({ configured: false });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Drives the local-provider panel. Re-runnable so installing the CLI while
  // the app is open doesn't strand the user on a stale "not found".
  const detect = useCallback(() => {
    setChecking(true);
    ai.localAgents()
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => { detect(); }, [detect]);

  const save = useCallback(async () => {
    if (!canSave) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      // A blank key updates the same provider using its keychain credential.
      // The backend requires a new key when the provider changes.
      await ai.setKey(isLocal ? '' : apiKey.trim(), provider, model.trim() || undefined);
      setApiKey(''); setSaved(true);
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Failed to save settings');
    } finally {
      setBusy(false);
    }
  }, [canSave, isLocal, apiKey, provider, model, refresh]);

  const remove = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      await ai.clearKey();
      setApiKey(''); setModel('');
      setSaved(false);
      setRemoveConfirm(false);
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Failed to remove key');
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return (
    <div className={`flex flex-col gap-6 ${docked ? 'min-h-full' : ''}`}>
      <div className="flex items-center gap-3 rounded-xl border border-border bg-bg-secondary/30 p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-bg-secondary text-secondary">
          <Sparkles className="size-5" strokeWidth={1.5} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-primary">
            {status === null ? 'Checking setup…' : status.configured ? 'Configured' : 'Not configured'}
          </p>
          <p className="truncate text-xs text-secondary">
            {status?.configured
              ? `${PROVIDERS.find((p) => p.id === status.provider)?.label ?? status.provider} · ${status.model ?? ''}`
              : 'Choose a provider to enable AI features.'}
          </p>
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-secondary">Provider</label>
        <Select ariaLabel="Provider" value={provider} onChange={(value) => {
          const next = value as ProviderId;
          setProvider(next);
          setApiKey('');
          setModel(next === status?.provider ? status.customModel ?? '' : '');
          setSaved(false);
          setError(null);
        }}>
          {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </Select>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-sm font-medium text-secondary" htmlFor="ai-model">Model</label>
          <span className="text-xs text-muted">Optional</span>
        </div>
        <Input
          id="ai-model"
          value={model}
          onChange={(value) => { setModel(value); setSaved(false); }}
          placeholder={meta.defaultModel}
        />
        <p className="text-xs text-muted">Leave empty to use the provider default.</p>
      </div>
      {isLocal ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs rounded-md border border-border px-2.5 py-1.5">
            <span
              className={`w-1.5 h-1.5 flex-shrink-0 rounded-full ${
                localAgent === undefined ? 'bg-muted' : localAgent.present ? 'bg-green-500' : 'bg-danger'
              }`}
            />
            <span className="min-w-0 flex-1">
              {localAgent === undefined
                ? 'Checking for a local agent…'
                : localAgent.present
                  ? <span className="text-primary">Found <span className="font-medium">{localAgent.name}</span>{localAgent.path && <span className="font-mono text-muted"> · {localAgent.path}</span>}</span>
                  : <span className="text-secondary">Claude Code not found — install it and run <span className="font-mono">claude</span> once to sign in, then check again.</span>}
            </span>
            <button
              onClick={detect}
              disabled={checking}
              className="flex-shrink-0 rounded-sm px-1.5 py-0.5 text-accent hover:bg-accent/10 disabled:opacity-40 transition-colors"
            >
              {checking ? 'Checking…' : 'Check again'}
            </button>
          </div>
          <p className="text-xs text-muted">
            Uses your own installed, authenticated Claude Code — no API key, and queries run through
            the agent you already have. Subject to your agreement with Anthropic.
          </p>
          {localAgent && !localAgent.present && (
            <p className="text-xs text-muted">
              You can still save this provider — justdb looks for the CLI again on every request.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <label htmlFor="ai-api-key" className="block text-sm font-medium text-secondary">API key</label>
          <Input
            id="ai-api-key"
            type="password"
            withPasswordToggle
            value={apiKey}
            onChange={(value) => { setApiKey(value); setSaved(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
            placeholder={sameProvider ? 'Saved in OS keychain' : meta.keyPlaceholder}
            containerClassName="w-full"
            className="font-mono"
          />
          {sameProvider && <p className="text-xs text-muted">A key is saved. Paste a new one to replace it.</p>}
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <Button
          onClick={() => void save()}
          disabled={busy || !canSave}
        >
          Save changes
        </Button>
        {status?.configured && (
          <button
            type="button"
            onClick={() => setRemoveConfirm(true)}
            disabled={busy}
            className="inline-flex min-h-9 items-center gap-2 rounded-md px-2 text-xs font-medium text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            <Trash2 className="size-4" strokeWidth={1.5} aria-hidden="true" />
            {isLocal ? 'Disconnect' : 'Remove key'}
          </button>
        )}
      </div>
      {saved && <span className="inline-flex items-center gap-1 text-xs text-success"><Check className="size-3.5" />Saved</span>}
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
      <div className={`rounded-xl border border-dashed border-border bg-bg-secondary/20 p-4 ${docked ? 'mt-auto' : ''}`}>
        <div className="flex items-start gap-3">
          <LockKeyhole className="mt-0.5 size-4 shrink-0 text-secondary" strokeWidth={1.5} aria-hidden="true" />
          <div className="space-y-2 text-xs leading-relaxed text-secondary">
            <p><strong className="text-primary">AI is opt-in.</strong> {isLocal
              ? 'The local agent runs on your machine using your own login. No key is stored.'
              : 'Keys are stored in the OS keychain and only leave your machine on requests you make.'}</p>
            <p>Used by the SQL editor’s Generate bar and AI mode.</p>
          </div>
        </div>
      </div>
      <ConfirmDialog
        isOpen={removeConfirm}
        onConfirm={() => void remove()}
        onCancel={() => setRemoveConfirm(false)}
        title={isLocal ? 'Disconnect local agent' : 'Remove AI key'}
        message={isLocal
          ? 'Disconnect this local agent from JustDB? You can set it up again later.'
          : 'Remove the saved API key from the OS keychain? AI features will stop working until you add a key again.'}
        confirmText={isLocal ? 'Disconnect' : 'Remove key'}
        variant="danger"
      />
    </div>
  );
};

// ─── Appearance ─────────────────────────────────────────────────────────────

const AppearanceSection: React.FC = () => {
  const { appearance, setAppearance } = useTheme();
  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary">White in light mode. Matte black in dark mode.</p>
      <div role="group" aria-label="Appearance mode" className="inline-flex border border-border rounded-md overflow-hidden">
        {(['system', 'light', 'dark'] as const).map(value => (
          <button key={value} type="button" aria-pressed={appearance === value}
            onClick={() => setAppearance(value)}
            className={`px-4 py-2 text-sm capitalize transition-colors ${appearance === value ? 'bg-accent text-[rgb(var(--accent-text))]' : 'text-secondary hover:bg-bg-secondary'}`}>
            {value}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">System follows your device’s appearance automatically.</p>
    </div>
  );
};

// ─── Data ───────────────────────────────────────────────────────────────────

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const DataSection: React.FC = () => {
  const [rowCap, setRowCap] = useState(String(getResultRowCap()));
  const [idleMin, setIdleMin] = useState(String(getIdleTimeoutMin()));
  const [lineNumbers, setLineNumbers] = useState(getEditorLineNumbers());

  const toggleLineNumbers = () => {
    const next = !lineNumbers;
    setLineNumbers(next);
    setEditorLineNumbers(next);
    window.dispatchEvent(new CustomEvent(EDITOR_SETTINGS_EVENT));
  };

  // Commit on blur/Enter so the field can be edited (incl. temporarily empty)
  // freely, then snaps to a clamped, persisted value that matches what's used.
  const commitRowCap = () => {
    const n = parseInt(rowCap, 10);
    const v = Number.isNaN(n) ? getResultRowCap() : clamp(n, 10, 5000);
    setResultRowCap(v);
    setRowCap(String(v));
  };
  const commitIdle = () => {
    const n = parseInt(idleMin, 10);
    const v = Number.isNaN(n) ? getIdleTimeoutMin() : clamp(n, 1, 1440);
    setIdleTimeoutMin(v);
    setIdleMin(String(v));
  };

  const numberInput =
    'w-32 px-2 py-1.5 text-sm border border-border rounded-md bg-bg text-primary focus:outline-hidden focus:ring-2 focus:ring-accent';

  return (
    <div className="space-y-4 px-4">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-secondary">Show line numbers in the SQL editor</label>
        <Switch
          checked={lineNumbers}
          onChange={toggleLineNumbers}
          size="sm"
          aria-label="Show line numbers"
        />
      </div>
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-secondary">SQL editor result limit</label>
        <Input
          inputMode="numeric"
          value={rowCap}
          onChange={(v) => setRowCap(v.replace(/[^0-9]/g, ''))}
          onBlur={commitRowCap}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className={numberInput}
        />
        <p className="text-xs text-muted">
          Max rows rendered before truncating (default {DEFAULT_ROW_CAP}, range 10–5000). Add an
          explicit LIMIT for more. Applies to the next query.
        </p>
      </div>
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-secondary">Idle disconnect (minutes)</label>
        <Input
          inputMode="numeric"
          value={idleMin}
          onChange={(v) => setIdleMin(v.replace(/[^0-9]/g, ''))}
          onBlur={commitIdle}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className={numberInput}
        />
        <p className="text-xs text-muted">
          Auto-disconnect after this much inactivity (default {DEFAULT_IDLE_MIN}, range 1–1440).
          Applies to the next connection.
        </p>
      </div>
    </div>
  );
};

// ─── Privacy ─────────────────────────────────────────────────────────────────

const PrivacySection: React.FC = () => {
  const [enabled, setEnabled] = useState(getTelemetryEnabled());

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    setTelemetryEnabled(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <label className="text-xs font-medium text-secondary">Send anonymous usage analytics</label>
        <Switch
          checked={enabled}
          onChange={toggle}
          size="sm"
          className="flex-shrink-0"
          aria-label="Send anonymous usage analytics"
        />
      </div>
      <p className="text-xs text-muted leading-relaxed">
        Helps us understand how many people use JustDB and which features matter.
        It's fully anonymous — no account, no tracking across sessions.
      </p>
      <div className="text-xs text-muted leading-relaxed space-y-1.5 border-t border-border pt-3">
        <p className="font-medium text-secondary">We never collect:</p>
        <ul className="list-disc list-inside space-y-0.5">
          <li>Your SQL, query results, or any row data</li>
          <li>Connection details — hosts, ports, database names, credentials</li>
          <li>Table names, column names, or file paths</li>
        </ul>
        <p className="pt-1">
          Only things like: app version, OS, database engine type, and coarse
          feature-usage counts.
        </p>
      </div>
    </div>
  );
};

import { useConnection } from '../contexts/connection-context';
import { useInstalledProviders, setProviderInstalled } from '@/lib/connector-catalog';
import React, { useState, useEffect, useCallback } from 'react';
import { Modal } from './ui/modal';
import { Select } from './ui/select';
import { FormatterSettingsBody } from './formatter-settings';
import { ai, PROVIDERS, type AiStatus, type ProviderId, type LocalAgentInfo } from '@/lib/ai';
import { useTheme } from '../contexts/theme-context';
import {
  getExperienceMode, setExperienceMode, type ExperienceMode,
  getResultRowCap, setResultRowCap, DEFAULT_ROW_CAP,
  getIdleTimeoutMin, setIdleTimeoutMin, DEFAULT_IDLE_MIN,
  getEditorLineNumbers, setEditorLineNumbers, EDITOR_SETTINGS_EVENT,
  getTelemetryEnabled, setTelemetryEnabled,
} from '@/lib/app-settings';
import { Check, Maximize2, PanelRightOpen, X } from 'lucide-react';
import { Input, Switch } from '@codellyson/justui/react';
import { Button } from './ui';
import { ConnectorLogo, type ConnectorKind } from './connector-logo';
import { ConfirmDialog } from './ui/confirm-dialog';
import { useMotionPresence } from '../hooks/use-motion-presence';

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
  const presence = useMotionPresence(isOpen);
  useEffect(() => {
    if (isOpen && initialTab) setTab(initialTab);
  }, [isOpen, initialTab]);
  if (!presence.mounted) return null;

  const navigation = (
      <nav
        aria-label="Settings sections"
        className={docked
          ? 'grid shrink-0 grid-cols-3 gap-1 border-b border-border p-3'
          : 'flex w-36 shrink-0 flex-col gap-0.5 border-r border-border pr-5 py-4'}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => setTab(t.id)}
            className={docked
              ? `min-h-9 min-w-0 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${tab === t.id ? 'bg-bg-secondary text-primary' : 'text-muted hover:bg-bg-secondary hover:text-primary'}`
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
      <div className={docked ? 'min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-5' : 'h-[min(60vh,520px)] min-w-0 flex-1 overflow-y-auto py-4 pr-1'}>
        <div key={tab} className="settings-section settings-content">
          <header className="mb-4">
            <h3 className="text-sm font-medium text-primary">{({ ai: 'AI assistant', connectors: 'Database connectors', appearance: 'Appearance', formatting: 'Cell formatting', data: 'Editor & results', privacy: 'Privacy' })[tab]}</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted">{({ ai: 'Provider and credentials for Generate and AI mode.', connectors: 'Connection types included with JustDB.', appearance: 'Choose how your workspace looks.', formatting: 'Change how values appear without changing stored data.', data: 'Defaults for queries and connections.', privacy: 'Choose what you share with JustDB.' })[tab]}</p>
          </header>
        {tab === 'ai' && <AiSection />}
        {tab === 'connectors' && <ConnectorsSection />}
        {tab === 'appearance' && <AppearanceSection />}
        {tab === 'formatting' && <FormatterSettingsBody embedded />}
        {tab === 'data' && <DataSection />}
        {tab === 'privacy' && <PrivacySection />}
        </div>
      </div>
  );

  if (docked) {
    return (
      <>
        <button
          type="button"
          onClick={onClose}
          data-visible={presence.visible}
          inert={!isOpen}
          className="settings-backdrop fixed inset-0 z-30 bg-black/40 lg:hidden"
          aria-label="Close settings"
        />
        <aside aria-label="Settings" aria-hidden={!isOpen} inert={!isOpen} data-visible={presence.visible} className="settings-drawer fixed inset-y-0 right-0 z-40 flex w-full max-w-[460px] flex-col border-l border-border bg-bg shadow-xl lg:shadow-none">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
            <h2 className="text-base font-semibold text-primary">Settings</h2>
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

const ConnectorsSection: React.FC = () => {
  const installed = useInstalledProviders();
  const { isConnected, activeConnector, databaseName, disconnect } = useConnection();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const disconnectActive = async () => {
    setBusy(true); setError(null);
    try { await disconnect(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  return <div className="space-y-5">
    {isConnected && <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
      <div className="min-w-0"><p className="text-sm text-primary">Active connection</p><p className="mt-1 break-all text-xs text-muted">{databaseName}</p></div>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void disconnectActive()}>Disconnect</Button>
    </div>}
    <div><p className="mb-1 text-xs text-muted">Default connectors</p>
      {[{ id: 'postgresql', name: 'PostgreSQL', detail: 'Local and remote servers' }, { id: 'sqlite', name: 'Local SQLite', detail: 'Database files on this device' }].map(item => <div key={item.id} className="flex items-center gap-3 border-b border-border py-3">
        <ConnectorLogo kind={item.id as ConnectorKind} className="size-5 shrink-0" />
        <div className="min-w-0 flex-1"><p className="text-sm text-primary">{item.name}</p><p className="mt-1 text-xs text-muted">{item.detail}</p></div>
        <span className="text-meta text-muted">Built in</span>
      </div>)}
    </div>
    <div><p className="text-xs text-muted">SQLite providers</p><p className="mt-1 text-xs leading-relaxed text-muted">Install to add a connection option. Provider support is bundled with JustDB.</p>
      {([{ id: 'd1', name: 'Cloudflare D1', detail: 'SQLite on Cloudflare' }, { id: 'turso', name: 'Turso / libSQL', detail: 'Remote SQLite databases' }] as const).map(item => <div key={item.id} className="flex items-center gap-3 border-b border-border py-3">
        <ConnectorLogo kind={item.id === 'd1' ? 'd1' : 'sqlite'} className="size-5 shrink-0" />
        <div className="min-w-0 flex-1"><p className="text-sm text-primary">{item.name}</p><p className="mt-1 text-xs text-muted">{item.detail}</p></div>
        <Button size="sm" variant="secondary" disabled={busy} onClick={async () => {
          const removing = installed.includes(item.id);
          if (removing && isConnected && activeConnector === item.id) {
            setBusy(true);
            try { await disconnect(); } catch (e) { setError(String(e)); return; } finally { setBusy(false); }
          }
          setProviderInstalled(item.id, !removing);
        }}>{installed.includes(item.id) ? 'Remove' : 'Install'}</Button>
      </div>)}
    </div>
    <div><p className="mb-1 text-xs text-muted">Coming soon</p>
      {['MariaDB', 'MySQL', 'MongoDB', 'CockroachDB'].map(name => <div key={name} className="flex items-center justify-between border-b border-border py-3 text-xs"><span className="text-secondary">{name}</span><span className="text-meta text-muted">Coming soon</span></div>)}
    </div>
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </div>;
};

// ─── AI ───────────────────────────────────────────────────────────────────

const AiSection: React.FC = () => {
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

  const configuredProvider = PROVIDERS.find(p => p.id === status?.provider);
  return (
    <div>
      <div className="flex items-center justify-between gap-3 pb-3 text-xs">
        <span className="text-muted">Current setup</span>
        <span className="inline-flex min-w-0 items-center gap-1.5 text-secondary">
          <span className={`size-1.5 shrink-0 rounded-full ${status?.configured ? 'bg-success' : 'bg-muted'}`} />
          {status === null ? 'Checking…' : status.configured
            ? `${configuredProvider?.local ? 'Claude Code' : configuredProvider?.label ?? status.provider}${status.model ? ` · ${status.model}` : ''}`
            : 'Not connected'}
        </span>
      </div>
      <div className="settings-field">
        <span className="settings-label" id="ai-provider-label">Provider</span>
        <div className="min-w-0" role="group" aria-labelledby="ai-provider-label">
          <Select className="settings-provider-select" containerClassName="w-full" ariaLabel="Provider" value={provider} onChange={(value) => {
            const next = value as ProviderId;
            setProvider(next); setApiKey('');
            setModel(next === status?.provider ? status.customModel ?? '' : '');
            setSaved(false); setError(null);
          }}>
            {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.local ? 'Claude Code (local)' : p.label}</option>)}
          </Select>
        </div>
      </div>
      <div className="settings-field">
        <label className="settings-label" htmlFor="ai-model">Model</label>
        <div className="min-w-0 space-y-1.5">
          <Input id="ai-model" value={model} onChange={value => { setModel(value); setSaved(false); }} placeholder={meta.defaultModel} />
          <p className="settings-help">Optional. Leave blank for the provider default.</p>
        </div>
      </div>
      {isLocal ? (
        <div className="settings-field">
          <span className="settings-label">Local agent</span>
          <div className="min-w-0 space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-secondary">{localAgent === undefined ? 'Checking…' : localAgent.present ? 'Claude Code detected' : 'Not found'}</span>
              <button onClick={detect} disabled={checking} className="shrink-0 rounded px-1 py-1 text-muted hover:bg-bg-secondary hover:text-primary disabled:opacity-40">{checking ? 'Checking…' : 'Recheck'}</button>
            </div>
            {localAgent?.path && <p className="break-all font-mono text-meta text-muted">{localAgent.path}</p>}
            <p className="settings-help">{localAgent && !localAgent.present
              ? 'Install Claude Code and run claude to sign in. You can save now and connect later.'
              : 'Uses your Claude Code login. No API key needed.'}</p>
          </div>
        </div>
      ) : (
        <div className="settings-field">
          <label htmlFor="ai-api-key" className="settings-label">API key</label>
          <div className="min-w-0 space-y-1.5">
            <Input id="ai-api-key" type="password" withPasswordToggle value={apiKey}
              onChange={value => { setApiKey(value); setSaved(false); }}
              onKeyDown={e => { if (e.key === 'Enter') void save(); }}
              placeholder={sameProvider ? 'Saved in OS keychain' : meta.keyPlaceholder} containerClassName="w-full" className="font-mono" />
            <p className="settings-help">{sameProvider ? 'A key is saved. Enter a new key to replace it.' : 'Stored securely in your OS keychain.'}</p>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-border py-4">
        <div className="text-xs text-muted" aria-live="polite">
          {saved ? <span className="inline-flex items-center gap-1"><Check className="size-3" />Saved</span> : hasChanges ? 'Unsaved changes' : 'Up to date'}
        </div>
        <Button size="sm" variant={canSave ? 'primary' : 'secondary'} isLoading={busy} onClick={() => void save()} disabled={busy || !canSave}>Save changes</Button>
      </div>
      {error && <p className="mb-3 text-xs text-danger" role="alert">{error}</p>}
      <details className="border-t border-border py-3 text-xs text-muted">
        <summary className="w-fit cursor-pointer rounded py-1 hover:text-primary">How AI uses your data</summary>
        <p className="mt-2 leading-relaxed">AI is opt-in. {isLocal
          ? 'Requests use your locally installed Claude Code and its signed-in account, subject to your agreement with Anthropic. No API key is stored by JustDB.'
          : 'Keys are stored in the OS keychain and used only for requests you make.'}</p>
      </details>
      {status?.configured && (
        <div className="flex items-center justify-between gap-3 border-t border-border py-3">
          <span className="text-xs text-muted">{configuredProvider?.local ? 'Local agent connection' : 'Saved credential'}</span>
          <button type="button" onClick={() => setRemoveConfirm(true)} disabled={busy}
            className="rounded px-2 py-1.5 text-xs text-muted hover:bg-danger/10 hover:text-danger disabled:opacity-40">
            {configuredProvider?.local ? 'Disconnect' : 'Remove key'}
          </button>
        </div>
      )}
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

      <div role="group" aria-label="Appearance mode" className="grid grid-cols-3 gap-1 rounded-md bg-bg-secondary p-1">
        {(['system', 'light', 'dark'] as const).map(value => (
          <button key={value} type="button" aria-pressed={appearance === value}
            onClick={() => setAppearance(value)}
            className={`rounded px-3 py-1.5 text-xs capitalize transition-colors ${appearance === value ? 'bg-bg text-primary shadow-sm' : 'text-secondary hover:bg-bg-secondary'}`}>
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
  const [experience, setExperience] = useState<ExperienceMode>(getExperienceMode);
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
    <div className="space-y-4">
      <div className="space-y-2 border-b border-border pb-4">
        <p className="text-sm text-primary">Experience mode</p>
        <div className="grid grid-cols-2 gap-1 rounded-md bg-bg-secondary p-1" role="group" aria-label="Experience mode">
          {(['guided', 'expert'] as const).map(mode => <button key={mode} type="button" aria-pressed={experience === mode} onClick={() => { setExperience(mode); setExperienceMode(mode); }} className={`rounded px-3 py-2 text-xs capitalize ${experience === mode ? 'bg-bg text-primary' : 'text-muted hover:text-primary'}`}>{mode}</button>)}
        </div>
        <p className="text-xs leading-relaxed text-muted">{experience === 'guided' ? 'Review changes before running write and destructive queries.' : 'Run queries directly, without confirmation prompts.'} Transactions are available in both modes.</p>
      </div>
      <div className="flex items-center justify-between gap-3 border-b border-border pb-4">
        <span className="text-xs text-secondary">Editor line numbers</span>
        <Switch
          checked={lineNumbers}
          onChange={toggleLineNumbers}
          size="sm"
          aria-label="Show line numbers"
        />
      </div>
      <div className="settings-field">
        <label htmlFor="settings-row-limit" className="settings-label">Row limit</label>
        <div className="space-y-1.5">
        <Input
          id="settings-row-limit"
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
      </div>
      <div className="settings-field">
        <label htmlFor="settings-idle-timeout" className="settings-label">Disconnect</label>
        <div className="space-y-1.5">
        <Input
          id="settings-idle-timeout"
          inputMode="numeric"
          value={idleMin}
          onChange={(v) => setIdleMin(v.replace(/[^0-9]/g, ''))}
          onBlur={commitIdle}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className={numberInput}
        />
        <p className="text-xs text-muted">
          Minutes of inactivity before disconnecting (default {DEFAULT_IDLE_MIN}, range 1–1440).
          Applies to the next connection.
        </p>
        </div>
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
        <label className="text-sm font-medium text-secondary">Send anonymous usage analytics</label>
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

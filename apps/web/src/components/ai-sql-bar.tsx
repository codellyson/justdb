import { AiErrorNotice } from './ai-error-notice';
import { aiErrorText } from '@/lib/ai-error';
import React, { useState, useEffect, useCallback } from 'react';
import { ai, type AiStatus } from '@/lib/ai';
import { Loader2, Sun } from 'lucide-react';
import { Input } from '@codellyson/justui/react';

interface AiSqlBarProps {
  /** "postgresql" | "sqlite" | "mysql" — steers dialect-specific SQL. */
  dialect: string;
  /** Pre-formatted schema text (see formatSchemaForPrompt). */
  schema: string;
  /** Generated SQL is handed back to the editor — never run automatically. */
  onGenerated: (sql: string, explanation: string) => void;
  disabled?: boolean;
}

const openSettings = () => window.dispatchEvent(new CustomEvent('justdb:open-settings'));

export const AiSqlBar: React.FC<AiSqlBarProps> = ({ dialect, schema, onGenerated, disabled }) => {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [prompt, setPrompt] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(() => {
    ai.status().then(setStatus).catch(() => setStatus({ configured: false }));
  }, []);

  // Re-check status on mount and whenever the window regains focus (covers the
  // user configuring/removing a key in the Settings modal).
  useEffect(() => {
    refreshStatus();
    window.addEventListener('focus', refreshStatus);
    return () => window.removeEventListener('focus', refreshStatus);
  }, [refreshStatus]);

  const generate = useCallback(async () => {
    if (!prompt.trim() || isBusy) return;
    setIsBusy(true);
    setError(null);
    try {
      const res = await ai.generateSql({ prompt: prompt.trim(), dialect, schema });
      if (!res.sql.trim()) {
        setError(res.explanation || 'The model could not produce a query for that request.');
        return;
      }
      onGenerated(res.sql, res.explanation);
    } catch (e: any) {
      setError(aiErrorText(e));
    } finally {
      setIsBusy(false);
    }
  }, [prompt, dialect, schema, isBusy, onGenerated]);

  // Still loading the initial status — render nothing to avoid a flash.
  if (status === null) return null;

  // Not configured → point the user at Settings (key management lives there now).
  if (!status.configured) {
    return (
      <div className="flex items-center gap-2 p-2.5 border border-border rounded-md bg-bg-secondary/30 text-sm">
        <span className="text-muted flex-1 min-w-0">Generate SQL from plain English — add an API key to enable it.</span>
        <button
          onClick={openSettings}
          className="px-3 py-1.5 text-sm rounded-sm bg-accent text-white hover:bg-accent-hover transition-colors flex-shrink-0"
        >
          Set up AI
        </button>
      </div>
    );
  }

  // Configured: a single rounded-sm field with the controls living inside it.
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1 pl-3 pr-1 py-1 border border-border rounded-md bg-bg focus-within:ring-2 focus-within:ring-accent transition-colors">
        <Input
          value={prompt}
          onChange={setPrompt}
          onKeyDown={(e) => { if (e.key === 'Enter') generate(); }}
          disabled={disabled || isBusy}
          placeholder="Describe the query in plain English…"
          containerClassName="flex-1 min-w-0"
          className="bg-transparent border-0 focus-visible:ring-0 px-0"
          aria-label="Describe the query you want in plain English"
        />
        <button
          onClick={openSettings}
          disabled={isBusy}
          title="AI settings"
          aria-label="AI settings"
          className="w-7 h-7 flex items-center justify-center rounded-sm text-muted hover:text-primary hover:bg-bg-secondary disabled:opacity-40 transition-colors flex-shrink-0"
        >
          <Sun className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={generate}
          disabled={disabled || isBusy || !prompt.trim()}
          className="px-3 py-1.5 text-sm rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-colors flex-shrink-0 flex items-center gap-1.5"
        >
          {isBusy ? (
            <Loader2 className="animate-spin h-3.5 w-3.5" />
          ) : null}
          {isBusy ? 'Generating…' : 'Generate'}
        </button>
      </div>
      {error && <AiErrorNotice message={error} provider={status?.provider} />}
    </div>
  );
};

import { AlertCircle, ExternalLink } from 'lucide-react';
import { describeAiError } from '@/lib/ai-error';

export function AiErrorNotice({ message, provider }: { message: string; provider?: string }) {
  const error = describeAiError(message, provider);
  return (
    <div className="min-w-0 rounded-xl border border-danger/25 bg-danger/5 p-3">
      <div className="flex items-start gap-2.5" role="alert">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-primary">{error.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-secondary">{error.description}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 pl-6.5 text-xs font-medium">
        {error.billingUrl && (
          <a href={error.billingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border bg-bg px-2.5 text-primary hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            Open billing <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        )}
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('justdb:open-settings', { detail: { tab: 'ai' } }))} className="min-h-8 rounded text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">AI settings</button>
      </div>
      <details className="mt-2 pl-6.5 text-xs text-muted">
        <summary className="cursor-pointer rounded py-1 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Technical details</summary>
        <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-mono text-[11px] leading-relaxed">{message}</p>
      </details>
    </div>
  );
}

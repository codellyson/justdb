import { useEffect, useState } from 'react';
import { Check, Copy, FileCode2, SquarePen } from 'lucide-react';
import { Button } from './ui/button';

interface ProposedSqlCardProps {
  sql: string;
  onReview: (sql: string) => void;
  onCopy: (sql: string) => Promise<boolean>;
}

export function ProposedSqlCard({ sql, onReview, onCopy }: ProposedSqlCardProps) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setCopied(false);
  }, [sql]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <section aria-label="Proposed SQL change" className="min-w-0 overflow-hidden rounded-xl border border-border bg-bg-secondary/30">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <FileCode2 className="size-4 shrink-0 text-muted" aria-hidden="true" />
          Proposed change
        </div>
        <span className="rounded-md bg-warning/10 px-2 py-1 text-meta font-medium text-warning">Not run</span>
      </div>
      <pre tabIndex={0} aria-label="Proposed SQL" className="max-h-56 overflow-auto border-y border-border bg-bg px-3 py-3 text-xs leading-6 text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"><code className="font-mono">{sql}</code></pre>
      <div className="space-y-3 p-3">
        <p className="text-xs leading-relaxed text-secondary">Review this SQL in the editor before running it.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="primary" onClick={() => onReview(sql)} className="gap-1.5" title="Open SQL for review without running it">
            <SquarePen className="size-3.5 shrink-0" aria-hidden="true" />
            Review in editor
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={async () => setCopied(await onCopy(sql))} className="gap-1.5">
            {copied ? <Check className="size-3.5 shrink-0" aria-hidden="true" /> : <Copy className="size-3.5 shrink-0" aria-hidden="true" />}
            <span aria-live="polite">{copied ? 'Copied' : 'Copy SQL'}</span>
          </Button>
        </div>
      </div>
    </section>
  );
}

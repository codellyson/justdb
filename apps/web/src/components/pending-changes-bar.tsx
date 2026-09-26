
import React from 'react';
import { PencilLine, ArrowRight } from 'lucide-react';
import { Button } from './ui/button';
import { usePendingChanges } from '../contexts/pending-changes-context';

interface PendingChangesBarProps {
  onOpenReview: () => void;
  target: { schema: string; table: string } | null;
}

export const PendingChangesBar: React.FC<PendingChangesBarProps> = ({ onOpenReview, target }) => {
  const pending = usePendingChanges();

  const count = target ? pending.getCount(target.schema, target.table) : 0;
  if (!target || count === 0) return null;

  return (
    <div
      aria-label="Pending changes"
      className="pending-changes floating-surface fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-4 p-3 bg-bg border border-border rounded-xl"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"><PencilLine className="size-4" aria-hidden="true" /></span>
        <div className="min-w-0">
          <p role="status" className="text-sm text-primary font-medium tabular-nums">{count} {count === 1 ? 'change' : 'changes'} pending</p>
          <p className="max-w-48 truncate text-xs text-muted" title={`${target.schema}.${target.table}`}>{target.table} · Not saved yet</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => pending.discardTable({ schema: target.schema, table: target.table })}
        >
          Discard
        </Button>
        <Button variant="primary" size="sm" onClick={onOpenReview}>
          Review & save <ArrowRight className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
};

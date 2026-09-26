import { useEffect, useId, useState } from 'react';
import { CornerDownLeft, X } from 'lucide-react';
import { describeFilters, type Filter } from '@/lib/filters';
import { parseFilterExpression } from '@/lib/filter-expression';

export function WhereFilterInput({ filters, columns, onApply, disabled }: {
  filters: Filter[];
  columns: string[];
  onApply: (filters: Filter[]) => void;
  disabled?: boolean;
}) {
  const applied = describeFilters(filters).replace(/^WHERE\s+/, '');
  const [draft, setDraft] = useState(applied);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  useEffect(() => { setDraft(applied); setError(null); }, [applied]);
  const submit = () => {
    try {
      const next = parseFilterExpression(draft, columns);
      onApply(next);
      setDraft(describeFilters(next).replace(/^WHERE\s+/, ''));
      setError(null);
    }
    catch (err) { setError(err instanceof Error ? err.message : 'Check the filter expression.'); }
  };
  return (
    <form className="relative min-w-[220px] flex-1" onSubmit={e => { e.preventDefault(); submit(); }}>
      <div className={`where-filter-field flex h-8 items-center overflow-hidden rounded-md border bg-bg ${error ? 'border-danger' : 'border-border focus-within:border-accent'} ${disabled ? 'opacity-50' : ''}`}>
        <label htmlFor={`${errorId}-input`} title="Combine filters with AND. Supports =, !=, IN, BETWEEN, IS NULL, IS NOT NULL, CONTAINS, and STARTS WITH." className="self-stretch flex items-center border-r border-border px-2 font-mono text-[10px] font-semibold text-accent">WHERE</label>
        <input id={`${errorId}-input`} aria-label="WHERE filter" aria-invalid={!!error} aria-describedby={error ? errorId : undefined} disabled={disabled} value={draft} onChange={e => { setDraft(e.target.value); setError(null); }} onKeyDown={e => { if (e.key === 'Escape') { setDraft(applied); setError(null); } }} placeholder="host = 'Mac' AND place IS NOT NULL" className="h-full min-w-0 flex-1 bg-transparent px-2 font-mono text-xs text-primary outline-none placeholder:text-muted" />
        {draft && <button type="button" disabled={disabled} aria-label="Clear WHERE filter" onClick={() => { setDraft(''); setError(null); onApply([]); }} className="flex size-7 shrink-0 items-center justify-center text-muted hover:text-primary"><X className="size-3" /></button>}
        <button type="submit" disabled={disabled} aria-label="Apply WHERE filter" title="Apply filter (Enter)" className="flex h-full shrink-0 items-center gap-1 px-2 text-[10px] text-muted hover:bg-bg-secondary hover:text-primary"><CornerDownLeft className="size-3" /><span className="hidden xl:inline">Apply</span></button>
      </div>
      {error && <p id={errorId} role="alert" className="absolute left-0 top-full z-50 mt-1 w-full rounded-md border border-danger/30 bg-bg px-3 py-2 text-xs text-danger shadow-lg">{error}</p>}
    </form>
  );
}

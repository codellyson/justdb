import { ExplainPlan } from './explain-plan';

export function QueryPlanContent({ plan }: { plan: unknown }) {
  const sqliteRows = Array.isArray(plan) && plan.every(row => row && typeof row.detail === 'string') ? plan : null;
  const postgres = Array.isArray(plan) && plan[0]?.Plan;
  return <div className="space-y-4">
    {sqliteRows ? (
      <div className="space-y-2" aria-label="Query plan operations">
        {sqliteRows.map((row, index) => <div key={`${row.id}-${index}`} className="flex items-start gap-3 rounded-md border border-border bg-bg-secondary/30 px-3 py-2.5">
          <span className="text-xs text-muted tabular-nums pt-0.5">{index + 1}</span>
          <code className="text-sm font-mono text-primary break-words">{row.detail}</code>
        </div>)}
      </div>
    ) : postgres ? <ExplainPlan plan={plan} /> : <p className="text-sm text-secondary">A structured preview is unavailable for this plan. View the raw plan below.</p>}
    <details className="text-xs text-muted">
      <summary className="cursor-pointer py-2 hover:text-primary">Raw plan JSON</summary>
      <pre className="mt-2 overflow-auto rounded-md bg-bg-secondary/40 p-3 font-mono whitespace-pre-wrap">{JSON.stringify(plan, null, 2)}</pre>
    </details>
  </div>;
}


import React, { useState } from "react";
import type { CascadeBucketEntry, CascadeResult } from "@/lib/cascade";

interface Props {
  loading: boolean;
  error: string | null;
  result: CascadeResult | null;
  extendedAttempted?: boolean;
  onRunFullPreview?: () => void;
  onRetry?: () => void;
}

export const CascadeImpactPanel: React.FC<Props> = ({
  loading,
  error,
  result,
  extendedAttempted = false,
  onRunFullPreview,
  onRetry,
}) => {
  const [showBreakdown, setShowBreakdown] = useState(false);

  if (loading) {
    return (
      <div className="border border-border rounded-md p-3 bg-bg-secondary/30">
        <div className="text-xs text-muted">
          {extendedAttempted ? "Running full preview…" : "Checking cascade impact…"}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-border rounded-md p-3 bg-bg-secondary/30 space-y-2">
        <div className="text-xs text-secondary">
          Cascade preview unavailable right now. Your delete can still proceed —
          the database will check foreign-key rules at save time and roll back
          the transaction if anything blocks.
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="px-2.5 py-1 text-xs font-medium text-secondary hover:text-primary border border-border rounded-sm hover:bg-bg-secondary transition-colors"
          >
            Retry preview
          </button>
        )}
      </div>
    );
  }

  if (!result) return null;

  const { cascade, setNull, blocked, truncated, warnings } = result;
  const totalCascade = cascade.reduce((s, e) => s + e.count, 0);
  const totalSetNull = setNull.reduce((s, e) => s + e.count, 0);
  const totalBlocked = blocked.reduce((s, e) => s + e.count, 0);
  const tableCount = cascade.length + setNull.length;

  const hasAny = cascade.length > 0 || setNull.length > 0 || blocked.length > 0;

  if (!hasAny && !truncated && warnings.length === 0) {
    return (
      <div className="border border-border rounded-md p-3 bg-bg-secondary/30 text-xs text-muted">
        No cascade impact — these deletes do not reference any dependent rows.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {truncated && (
        <TruncatedBanner
          extendedAttempted={extendedAttempted}
          onRunFullPreview={onRunFullPreview}
        />
      )}

      {blocked.length > 0 && (
        <BlockedBanner entries={blocked} totalRows={totalBlocked} />
      )}

      {(cascade.length > 0 || setNull.length > 0) && (
        <div className="border border-border rounded-md overflow-hidden">
          <button
            type="button"
            onClick={() => setShowBreakdown((v) => !v)}
            className="w-full px-3 py-2 bg-bg-secondary/50 border-b border-border flex items-center gap-3 text-xs hover:bg-bg-secondary/70 transition-colors text-left"
          >
            <span className="font-medium text-primary">Cascade impact</span>
            <span className="text-secondary">
              {totalCascade + totalSetNull} row
              {totalCascade + totalSetNull === 1 ? "" : "s"} across {tableCount}{" "}
              table{tableCount === 1 ? "" : "s"}
            </span>
            <span className="ml-auto text-muted text-meta">
              {showBreakdown ? "hide" : "show breakdown"}
            </span>
          </button>
          {showBreakdown && (
            <div className="divide-y divide-border max-h-[40vh] overflow-y-auto">
              {cascade.map((e, i) => (
                <BucketRow key={`c-${i}`} entry={e} kind="cascade" />
              ))}
              {setNull.map((e, i) => (
                <BucketRow key={`s-${i}`} entry={e} kind="setNull" />
              ))}
            </div>
          )}
        </div>
      )}

      {!truncated && warnings.length > 0 && (
        <div className="border border-border rounded-md p-2 bg-bg-secondary/30 text-meta text-muted space-y-0.5">
          {warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}
    </div>
  );
};

const TruncatedBanner: React.FC<{
  extendedAttempted: boolean;
  onRunFullPreview?: () => void;
}> = ({ extendedAttempted, onRunFullPreview }) => {
  if (extendedAttempted) {
    return (
      <div className="border border-border rounded-md p-3 bg-bg-secondary/30 text-meta text-muted">
        Cascade is bigger than we could map. The breakdown above is partial —
        the actual delete may touch more rows.
      </div>
    );
  }
  return (
    <div className="border border-border rounded-md p-3 bg-bg-secondary/30 space-y-2 text-meta text-muted">
      <div>
        We didn’t finish mapping the cascade. The breakdown above is partial.
      </div>
      {onRunFullPreview && (
        <button
          type="button"
          onClick={onRunFullPreview}
          className="px-2.5 py-1 text-xs font-medium text-secondary hover:text-primary border border-border rounded-sm hover:bg-bg-secondary transition-colors"
        >
          Keep mapping
        </button>
      )}
    </div>
  );
};

const BlockedBanner: React.FC<{
  entries: CascadeBucketEntry[];
  totalRows: number;
}> = ({ entries, totalRows }) => {
  return (
    <div className="border border-warning/40 bg-warning/10 rounded-md p-3 space-y-1.5">
      <div className="text-xs font-medium text-warning">
        {totalRows} referencing row{totalRows === 1 ? "" : "s"} with RESTRICT —
        the database will refuse this delete
      </div>
      <ul className="text-xs text-secondary space-y-0.5 pl-1">
        {entries.map((e, i) => (
          <li key={i}>
            <span className="font-mono text-primary">
              {qualified(e.schema, e.table)}
            </span>
            <span className="text-muted">
              {" "}·{" "}
              {e.count} row{e.count === 1 ? "" : "s"} ({e.deleteRule})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const BucketRow: React.FC<{
  entry: CascadeBucketEntry;
  kind: "cascade" | "setNull";
}> = ({ entry, kind }) => {
  const [expanded, setExpanded] = useState(false);
  const ruleLabel = kind === "cascade" ? "CASCADE" : entry.deleteRule;

  return (
    <div className="px-3 py-2 text-xs">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 text-left hover:bg-bg-secondary/40 -mx-3 px-3 -my-2 py-2 transition-colors"
      >
        <span className="font-mono text-primary">
          {qualified(entry.schema, entry.table)}
        </span>
        <span className="text-secondary">
          {entry.count} row{entry.count === 1 ? "" : "s"}
        </span>
        <span className="text-meta uppercase tracking-wide text-muted">
          {ruleLabel}
        </span>
        {entry.truncated && (
          <span className="text-muted text-meta">truncated</span>
        )}
        <span className="ml-auto text-muted text-meta">
          {expanded ? "−" : "+"}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 pl-3 border-l-2 border-border text-meta text-muted space-y-0.5">
          <div>
            via{" "}
            <span className="font-mono">{entry.fkColumns.join(", ")}</span>
            {" → "}
            <span className="font-mono">
              {qualified(entry.parentSchema, entry.parentTable)}.
              {entry.parentColumns.join(", ")}
            </span>
          </div>
          <div>
            constraint: <span className="font-mono">{entry.fkConstraint}</span>
          </div>
        </div>
      )}
    </div>
  );
};

function qualified(schema: string, table: string): string {
  if (!schema || schema === "main") return table;
  return `${schema}.${table}`;
}

import { Database } from 'lucide-react';

export type ConnectorKind = 'postgresql' | 'sqlite' | 'd1';

/** Shared icon column for saved and discovered connection rows. */
export function ConnectorBadge({ kind }: { kind: ConnectorKind }) {
  const label = kind === 'd1' ? 'Cloudflare D1' : kind === 'sqlite' ? 'SQLite' : 'PostgreSQL';
  return (
    <span aria-label={label} className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${kind === 'd1' ? 'bg-amber-500/15' : kind === 'sqlite' ? 'bg-emerald-500/15' : 'bg-accent/15'}`}>
      <ConnectorLogo kind={kind} className="size-6" />
    </span>
  );
}

interface ConnectorLogoProps {
  kind: ConnectorKind;
  className?: string;
}

// Keep upstream artwork intact. D1 uses a neutral icon because Cloudflare's
// trademark guidelines require written permission for its logos.
export function ConnectorLogo({ kind, className = 'size-5' }: ConnectorLogoProps) {
  if (kind === 'postgresql') {
    return <img src="/connectors/postgresql.svg" alt="" aria-hidden="true" className={`${className} object-contain`} />;
  }
  if (kind === 'sqlite') {
    return <img src="/connectors/sqlite.gif" alt="" aria-hidden="true" className={`${className} object-contain`} />;
  }
  return <Database aria-hidden="true" className={`${className} text-amber-400`} strokeWidth={1.5} />;
}

import { Database } from 'lucide-react';

export type ConnectorKind = 'postgresql' | 'sqlite' | 'd1';

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

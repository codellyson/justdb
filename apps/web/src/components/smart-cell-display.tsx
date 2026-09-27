
import { useEffect, useRef, useState, memo } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Eye } from 'lucide-react';

interface SmartCellDisplayProps {
  value: any;
  column?: string;
  columnType?: string;
  /** When true, ISO timestamp is shown raw instead of locale-formatted. */
  rawTimestamps?: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidType(columnType?: string): boolean {
  return columnType?.toLowerCase() === 'uuid';
}

function isJsonType(columnType?: string): boolean {
  const t = columnType?.toLowerCase();
  return t === 'json' || t === 'jsonb';
}

function isBoolType(columnType?: string): boolean {
  const t = columnType?.toLowerCase();
  return t === 'boolean' || t === 'bool';
}

function isDateType(columnType?: string): boolean {
  const t = columnType?.toLowerCase() ?? '';
  return (
    t === 'date' ||
    t === 'timestamp' ||
    t === 'timestamptz' ||
    t === 'timestamp without time zone' ||
    t === 'timestamp with time zone' ||
    t === 'datetime'
  );
}

const IMAGE_NAME_RE = /^(image|avatar|photo|picture|thumbnail|cover|logo)(_url|url)?$/i;
const IMAGE_URL_RE = /^https?:\/\/[^\s]+\.(png|jpe?g|gif|webp|svg|avif)(\?[^\s]*)?$/i;

// Column names that should mask their cell value by default. We don't want
// bcrypt hashes / API keys / secrets sitting in plaintext in screenshots and
// support sessions. Click the dot row to reveal the underlying string.
const SENSITIVE_NAME_RE = /(^|_)(password(_?hash)?|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|auth[_-]?token|session[_-]?token)$/i;

function isSensitiveColumn(column?: string): boolean {
  return !!column && SENSITIVE_NAME_RE.test(column);
}

function looksLikeImage(column?: string, value?: any): boolean {
  if (typeof value !== 'string') return false;
  if (column && IMAGE_NAME_RE.test(column)) return true;
  return IMAGE_URL_RE.test(value);
}

function formatTimestamp(value: any, raw: boolean): string {
  if (raw) return String(value);
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

export const SmartCellDisplay = memo(function SmartCellDisplay({
  value,
  column,
  columnType,
  rawTimestamps,
}: SmartCellDisplayProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  if (value === null || value === undefined) {
    return <span className="text-muted italic">NULL</span>;
  }

  // Sensitive value (password hash, API key, etc.) — render as a row of
  // dots; click to reveal in place. Keeps secrets out of screenshots
  // without blocking debugging.
  if (isSensitiveColumn(column)) {
    const stringValue = String(value);
    if (!expanded) {
      return (
        <span
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
          }}
          className="inline-flex items-center gap-1.5 cursor-pointer text-muted hover:text-primary transition-colors"
          title="Click to reveal"
        >
          <span className="font-mono tracking-widest select-none">••••••••</span>
          <Eye className="w-3 h-3 flex-shrink-0" />
        </span>
      );
    }
    return (
      <span
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(false);
        }}
        className="cursor-pointer hover:text-primary transition-colors"
        title="Click to hide"
      >
        <span className="truncate">{stringValue}</span>
      </span>
    );
  }

  if (isBoolType(columnType) || typeof value === 'boolean') {
    const truthy = value === true || value === 'true' || value === 't' || value === 1 || value === '1';
    return <span title={String(value)}>{truthy ? 'true' : 'false'}</span>;
  }

  // UUID → truncated + copy on hover. Detect by type or by string shape.
  const valueStr = typeof value === 'string' ? value : '';
  if ((isUuidType(columnType) || UUID_RE.test(valueStr)) && valueStr) {
    const truncated = valueStr.slice(0, 8) + '…';
    return (
      <span className="inline-flex items-center gap-1 group/uuid" title={valueStr}>
        <span className="font-mono">{truncated}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(valueStr).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            });
          }}
          className="opacity-0 group-hover/uuid:opacity-100 text-muted hover:text-primary transition-opacity"
          aria-label="Copy UUID"
        >
          {copied ? (
            <Check className="w-3 h-3 text-success" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
        </button>
      </span>
    );
  }

  // JSON / JSONB / object → {} icon + click-to-expand pretty-print.
  if (isJsonType(columnType) || typeof value === 'object') {
    const pretty = (() => {
      try {
        const obj = typeof value === 'string' ? JSON.parse(value) : value;
        return JSON.stringify(obj, null, 2);
      } catch {
        return String(value);
      }
    })();
    const inline =
      typeof value === 'object' ? JSON.stringify(value) : String(value);
    return (
      <JsonCell
        inline={inline}
        pretty={pretty}
        expanded={expanded}
        onToggle={setExpanded}
      />
    );
  }

  // Image preview.
  if (looksLikeImage(column, value)) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <img
          src={valueStr}
          alt=""
          className="h-5 w-5 rounded-sm object-cover bg-bg-secondary flex-shrink-0"
          loading="lazy"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
        <span className="truncate text-muted">{valueStr}</span>
      </span>
    );
  }

  // Timestamp / date — format in user's locale.
  if (isDateType(columnType)) {
    const formatted = formatTimestamp(value, !!rawTimestamps);
    return <span title={String(value)}>{formatted}</span>;
  }

  // Long text — hover tooltip + click to expand inline.
  const stringValue = String(value);
  if (stringValue.length > 100) {
    if (expanded) {
      return (
        <span
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(false);
          }}
          className="cursor-pointer break-all whitespace-pre-wrap"
          title="Click to collapse"
        >
          {stringValue}
        </span>
      );
    }
    return (
      <span
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(true);
        }}
        title={stringValue}
        className="cursor-pointer hover:text-primary"
      >
        {stringValue.slice(0, 80)}
        <span className="text-muted">… {stringValue.length} chars</span>
      </span>
    );
  }

  return <span title={stringValue}>{stringValue}</span>;
});

/**
 * Renders the collapsed `{}` chip in flow and, when expanded, the
 * pretty-printed JSON in a portal anchored to the chip. The portal hops
 * over every overflow:hidden/truncate ancestor the table layout puts in
 * the way and stacks above subsequent virtual rows (z-50). Click the
 * chip again or anywhere outside the popover to collapse.
 */
function JsonCell({
  inline,
  pretty,
  expanded,
  onToggle,
}: {
  inline: string;
  pretty: string;
  expanded: boolean;
  onToggle: (next: boolean) => void;
}) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!expanded || !anchorRef.current) return;
    const update = () => {
      if (anchorRef.current) setRect(anchorRef.current.getBoundingClientRect());
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      const pop = document.getElementById('json-popover');
      if (pop && pop.contains(t)) return;
      onToggle(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [expanded, onToggle]);

  return (
    <span
      ref={anchorRef}
      className="inline-flex items-center gap-1 cursor-pointer hover:text-primary"
      onClick={(e) => {
        e.stopPropagation();
        onToggle(!expanded);
      }}
      title={expanded ? 'Click to collapse' : 'Click to pretty-print'}
    >
      <span className="text-meta text-accent font-mono">{'{}'}</span>
      <span className="truncate">{inline}</span>
      {expanded && rect && typeof document !== 'undefined' &&
        createPortal(
          <pre
            id="json-popover"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: rect.bottom + 4,
              left: Math.max(8, Math.min(rect.left, window.innerWidth - 460)),
              maxHeight: Math.min(384, window.innerHeight - rect.bottom - 16),
            }}
            className="z-50 w-[28rem] max-w-[60vw] overflow-auto text-meta font-mono whitespace-pre-wrap break-all bg-bg p-2 rounded-sm border border-border shadow-lg"
          >
            {pretty}
          </pre>,
          document.body,
        )}
    </span>
  );
}


import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Filter, FilterOperator } from '@/lib/filters';
import { Input, Select, Textarea } from '@codellyson/justui/react';

interface ColumnFilterPopoverProps {
  column: string;
  columnType?: string;
  initial?: Filter;
  anchorRect: DOMRect | null;
  onApply: (filter: Filter) => void;
  onClear: () => void;
  onClose: () => void;
}

const OPERATOR_OPTIONS: { value: FilterOperator; label: string }[] = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'is_null', label: 'is NULL' },
  { value: 'is_not_null', label: 'is not NULL' },
  { value: 'between', label: 'between' },
  { value: 'in', label: 'in' },
];

function isNumeric(columnType?: string): boolean {
  if (!columnType) return false;
  const t = columnType.toLowerCase();
  return (
    t.includes('int') ||
    t === 'numeric' ||
    t === 'decimal' ||
    t === 'real' ||
    t === 'float' ||
    t.includes('double') ||
    t === 'serial' ||
    t === 'bigserial' ||
    t === 'smallserial'
  );
}

export const ColumnFilterPopover: React.FC<ColumnFilterPopoverProps> = ({
  column,
  columnType,
  initial,
  anchorRect,
  onApply,
  onClear,
  onClose,
}) => {
  const [operator, setOperator] = useState<FilterOperator>(initial?.operator ?? 'eq');
  const [value, setValue] = useState<string>(
    initial?.value === undefined || initial?.value === null ? '' : String(initial.value)
  );
  const [low, setLow] = useState<string>(
    initial?.values?.[0] === undefined ? '' : String(initial.values[0])
  );
  const [high, setHigh] = useState<string>(
    initial?.values?.[1] === undefined ? '' : String(initial.values[1])
  );
  const [list, setList] = useState<string>(
    initial?.values ? initial.values.join(', ') : ''
  );

  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLButtonElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [onClose]);

  const needsValue =
    operator !== 'is_null' && operator !== 'is_not_null' && operator !== 'between' && operator !== 'in';
  const numeric = isNumeric(columnType);

  const handleApply = () => {
    if (operator === 'is_null' || operator === 'is_not_null') {
      onApply({ column, operator });
    } else if (operator === 'between') {
      if (low === '' || high === '') return;
      const parsed = numeric ? [Number(low), Number(high)] : [low, high];
      onApply({ column, operator, values: parsed });
    } else if (operator === 'in') {
      const parts = list
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length === 0) return;
      const parsed = numeric ? parts.map(Number) : parts;
      onApply({ column, operator, values: parsed });
    } else {
      const v = numeric && (operator === 'eq' || operator === 'neq') ? Number(value) : value;
      onApply({ column, operator, value: v });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (typeof window === 'undefined') return null;
  const top = (anchorRect?.bottom ?? 100) + 4;
  const left = Math.min(
    anchorRect?.left ?? 100,
    typeof window !== 'undefined' ? window.innerWidth - 320 : 100
  );

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`Filter ${column}`}
      className="fixed z-50 w-72 bg-bg border border-border rounded-md shadow-xl"
      style={{ top, left }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-2 border-b border-border">
        <div className="text-xs text-muted">Filter</div>
        <div className="text-sm font-medium text-primary truncate">{column}</div>
      </div>
      <div className="p-3 space-y-2">
        <Select
          ref={inputRef as React.RefObject<HTMLButtonElement>}
          value={operator}
          onChange={(v) => setOperator(v as FilterOperator)}
          options={OPERATOR_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          className="w-full"
        />

        {needsValue && (
          <Input
            inputMode={numeric && (operator === 'eq' || operator === 'neq') ? 'numeric' : undefined}
            value={value}
            onChange={setValue}
            onKeyDown={handleKeyDown}
            placeholder="Value"
            containerClassName="w-full"
            className="font-mono"
          />
        )}

        {operator === 'between' && (
          <div className="flex gap-1.5">
            <Input
              inputMode={numeric ? 'numeric' : undefined}
              value={low}
              onChange={setLow}
              onKeyDown={handleKeyDown}
              placeholder="From"
              containerClassName="flex-1 min-w-0"
              className="font-mono"
            />
            <Input
              inputMode={numeric ? 'numeric' : undefined}
              value={high}
              onChange={setHigh}
              onKeyDown={handleKeyDown}
              placeholder="To"
              containerClassName="flex-1 min-w-0"
              className="font-mono"
            />
          </div>
        )}

        {operator === 'in' && (
          <Textarea
            value={list}
            onChange={setList}
            onKeyDown={handleKeyDown}
            placeholder="Comma-separated values"
            rows={2}
            containerClassName="w-full"
            className="font-mono min-h-0 resize-none"
          />
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-border bg-bg-secondary/30">
        <button
          type="button"
          onClick={() => {
            onClear();
            onClose();
          }}
          className="text-meta text-muted hover:text-primary px-1.5 py-0.5 transition-colors"
        >
          Clear
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 text-meta font-medium text-secondary hover:text-primary hover:bg-bg-secondary rounded-sm transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="px-2.5 py-1 text-meta font-medium text-[rgb(var(--accent-text))] bg-accent hover:bg-accent-hover rounded-sm transition-colors"
          >
            Apply
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

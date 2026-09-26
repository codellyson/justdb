
import React, { useState, useRef, useEffect, useCallback, useLayoutEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import { SmartCellDisplay } from './smart-cell-display';
import { Input, Select, Textarea } from '@codellyson/justui/react';

export type SaveIntent = 'right' | 'left' | 'down' | null;

interface EditableCellProps {
  value: any;
  /** Token shown for an untouched draft cell (NULL / DEFAULT). */
  placeholder?: string;
  column: string;
  columnType?: string;
  onSave: (column: string, newValue: any, intent?: SaveIntent) => void;
  onCancel: () => void;
  isEditing: boolean;
  onStartEdit: () => void;
  disabled?: boolean;
}

type EditorKind = 'text' | 'number' | 'boolean' | 'json' | 'textarea' | 'date' | 'datetime' | 'uuid';

function inferEditor(columnType?: string, value?: any): EditorKind {
  if (!columnType) return 'text';
  const t = columnType.toLowerCase();

  if (t === 'boolean' || t === 'bool') return 'boolean';
  if (t === 'json' || t === 'jsonb') return 'json';
  if (t === 'uuid') return 'uuid';
  // Date-only types — render with native date picker.
  if (t === 'date') return 'date';
  // Timestamp-with/without-tz, datetime — render with datetime-local picker.
  if (t === 'timestamp' || t === 'timestamptz' || t === 'timestamp without time zone' ||
      t === 'timestamp with time zone' || t === 'datetime') return 'datetime';
  if (t.includes('int') || t === 'numeric' || t === 'decimal' ||
      t === 'real' || t === 'float' || t.includes('double') ||
      t === 'smallserial' || t === 'serial' || t === 'bigserial') return 'number';
  if (t === 'text' || t.includes('varchar') || t.includes('char')) {
    if (value !== null && value !== undefined && String(value).length > 60) return 'textarea';
  }

  return 'text';
}

function formatForEditor(value: any, kind: EditorKind): string {
  if (value === null || value === undefined) return '';
  if (kind === 'json') {
    try {
      return typeof value === 'string' ? JSON.stringify(JSON.parse(value), null, 2) : JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  if (kind === 'date') {
    // Coerce to YYYY-MM-DD for the native date input.
    const s = String(value);
    const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return isoMatch ? isoMatch[1] : s;
  }
  if (kind === 'datetime') {
    // Coerce to YYYY-MM-DDTHH:mm for the datetime-local input.
    const s = String(value);
    const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
    return m ? `${m[1]}T${m[2]}` : s;
  }
  return String(value);
}

interface PopoverPosition {
  top: number;
  left: number;
  width: number;
}

// Pin the popover to the cell's top-left, widen beyond the cell if needed,
// and shift back into the viewport if the right/bottom edge would clip.
function computePosition(anchor: DOMRect, popoverSize: { width: number; height: number }): PopoverPosition {
  const margin = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const desiredWidth = Math.max(popoverSize.width, anchor.width);

  let left = anchor.left;
  if (left + desiredWidth + margin > vw) left = Math.max(margin, vw - desiredWidth - margin);

  let top = anchor.top;
  if (top + popoverSize.height + margin > vh) {
    // Flip above the cell if there's more room up there.
    const aboveTop = anchor.top - popoverSize.height - 4;
    top = aboveTop > margin ? aboveTop : Math.max(margin, vh - popoverSize.height - margin);
  }

  return { top, left, width: desiredWidth };
}

/**
 * A cell at rest. EditableCell carries 13 hooks for the editing popover; a
 * 50-row grid mounts hundreds of cells and needs none of that until one is
 * actually being edited, so the display path is kept hook-free.
 */
export function CellDisplay({
  value,
  placeholder,
  column,
  columnType,
  disabled,
  onStartEdit,
}: {
  value: any;
  placeholder?: string;
  column: string;
  columnType?: string;
  disabled?: boolean;
  onStartEdit?: () => void;
}) {
  return (
    <div
      className={`truncate ${!disabled ? 'cursor-text' : ''}`}
      onDoubleClick={!disabled ? onStartEdit : undefined}
    >
      {placeholder !== undefined && value === undefined ? (
        <span className="text-warning/80">{placeholder}</span>
      ) : (
        <SmartCellDisplay value={value} column={column} columnType={columnType} />
      )}
    </div>
  );
}

export const EditableCell = memo(function EditableCell({
  value,
  placeholder,
  column,
  columnType,
  onSave,
  onCancel,
  isEditing,
  onStartEdit,
  disabled = false,
}: EditableCellProps) {
  const editorKind = inferEditor(columnType, value);
  const isLargeEditor = editorKind === 'json' || editorKind === 'textarea';

  const [editValue, setEditValue] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  const cellRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Snap the editValue back to the current cell value whenever we enter edit mode.
  useEffect(() => {
    if (isEditing) {
      setEditValue(formatForEditor(value, editorKind));
      setJsonError(null);
    }
  }, [isEditing, value, editorKind]);

  // Position the popover relative to the cell, then re-position on scroll/resize
  // so it stays anchored. Cancel the edit if the underlying cell scrolls off-screen
  // far enough that the popover would float orphaned.
  useLayoutEffect(() => {
    if (!isEditing) {
      setPosition(null);
      return;
    }
    const popoverSize = isLargeEditor
      ? { width: 520, height: 340 }
      : { width: 320, height: 112 };

    const place = () => {
      const anchor = cellRef.current?.getBoundingClientRect();
      if (!anchor) return;
      setPosition(computePosition(anchor, popoverSize));
    };
    place();

    const onScrollOrResize = () => place();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [isEditing, isLargeEditor]);

  // Focus the relevant field once the popover is on screen.
  useEffect(() => {
    if (!isEditing || !position) return;
    const t = setTimeout(() => {
      if (isLargeEditor) {
        textareaRef.current?.focus();
        textareaRef.current?.select();
      } else {
        inputRef.current?.focus();
        if (inputRef.current && 'select' in inputRef.current) {
          (inputRef.current as HTMLInputElement).select();
        }
      }
    }, 0);
    return () => clearTimeout(t);
  }, [isEditing, position, isLargeEditor]);

  // Outside-click cancels. Uses mousedown so it fires before focus changes
  // confuse the buttons inside the popover.
  useEffect(() => {
    if (!isEditing) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (cellRef.current?.contains(target)) return;
      onCancel();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [isEditing, onCancel]);

  // Saves the current editor value with optional navigation intent.
  // Empty string is preserved as-is — use the "Set NULL" affordance to
  // explicitly write NULL. The SQL builder coerces empty strings to NULL
  // for non-text columns, so text columns get a real empty-string and
  // numeric/date columns get NULL.
  const save = useCallback(
    (intent: SaveIntent = null) => {
      if (editorKind === 'json') {
        if (editValue === '') {
          onSave(column, null, intent);
          return;
        }
        try {
          JSON.parse(editValue);
          setJsonError(null);
        } catch (e: any) {
          setJsonError(e.message);
          return;
        }
      }
      onSave(column, editValue, intent);
    },
    [column, editValue, editorKind, onSave]
  );

  const setNull = useCallback(() => {
    onSave(column, null);
  }, [column, onSave]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      return;
    }
    // Large editors: let Enter insert newlines and Tab insert tabs natively.
    // Mod+Enter saves and stays on the cell.
    if (isLargeEditor) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        save();
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      save('down');
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      save(e.shiftKey ? 'left' : 'right');
    }
  };

  return (
    <>
      <div
        ref={cellRef}
        className={`truncate ${!disabled ? 'cursor-text' : ''} ${isEditing ? 'opacity-40' : ''}`}
        onDoubleClick={!disabled ? onStartEdit : undefined}
      >
        {placeholder !== undefined && value === undefined ? (
          <span className="text-warning/80">{placeholder}</span>
        ) : (
          <SmartCellDisplay value={value} column={column} columnType={columnType} />
        )}
      </div>

      {isEditing && position && typeof window !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-50 bg-bg border border-border rounded-md shadow-xl flex flex-col overflow-hidden"
            style={{
              top: position.top,
              left: position.left,
              width: position.width,
            }}
            // Stop React-synthetic event propagation so clicks inside the
            // editor don't bubble up to the Cell (which is the React parent
            // even though the DOM parent is document.body via the portal).
            // The Cell's onClick blurs the active element to defeat
            // CodeMirror; without this, clicking the input would blur-sm it.
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
          >
            {/* Header: column name + type */}
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-border bg-bg-secondary/40 flex-shrink-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs font-medium text-primary truncate">{column}</span>
                {columnType && (
                  <span className="text-[10px] font-mono text-muted flex-shrink-0">{columnType}</span>
                )}
              </div>
              <div className="flex items-center gap-1 text-[10px] text-muted flex-shrink-0">
                <kbd className="px-1 py-0.5 bg-bg rounded-sm border border-border">
                  {isLargeEditor
                    ? (typeof navigator !== 'undefined' && navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl') + '+Enter'
                    : 'Enter'}
                </kbd>
                <span>save</span>
              </div>
            </div>

            {/* Body: input */}
            <div className="p-2 flex-1 min-h-0">
              {editorKind === 'boolean' ? (
                <Select
                  ref={inputRef as React.RefObject<HTMLButtonElement>}
                  value={editValue}
                  onChange={setEditValue}
                  options={[
                    { value: '', label: 'NULL' },
                    { value: 'true', label: 'true' },
                    { value: 'false', label: 'false' },
                  ]}
                  className="w-full font-mono"
                />
              ) : isLargeEditor ? (
                <Textarea
                  ref={textareaRef}
                  value={editValue}
                  onChange={(v) => {
                    setEditValue(v);
                    if (jsonError) setJsonError(null);
                  }}
                  onKeyDown={handleKeyDown}
                  rows={12}
                  spellCheck={false}
                  error={jsonError ? true : undefined}
                  containerClassName="w-full h-full"
                  className="h-full font-mono resize-none min-h-0"
                />
              ) : editorKind === 'uuid' ? (
                <div className="flex gap-1.5">
                  <Input
                    ref={inputRef as React.RefObject<HTMLInputElement>}
                    value={editValue}
                    onChange={setEditValue}
                    onKeyDown={handleKeyDown}
                    placeholder="00000000-0000-0000-0000-000000000000"
                    containerClassName="flex-1 min-w-0"
                    className="font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                        setEditValue(crypto.randomUUID());
                      }
                    }}
                    className="px-2 py-1.5 text-[11px] font-medium text-secondary hover:text-primary border border-border rounded-sm hover:bg-bg-secondary transition-colors flex-shrink-0"
                    title="Generate a new UUID"
                  >
                    Generate
                  </button>
                </div>
              ) : editorKind === 'date' || editorKind === 'datetime' ? (
                <input
                  ref={inputRef as React.RefObject<HTMLInputElement>}
                  type={editorKind === 'date' ? 'date' : 'datetime-local'}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full px-2 py-1.5 text-sm font-mono border border-border rounded-sm bg-bg text-primary focus:outline-hidden focus:ring-2 focus:ring-accent"
                />
              ) : (
                <Input
                  ref={inputRef as React.RefObject<HTMLInputElement>}
                  inputMode={editorKind === 'number' ? 'decimal' : undefined}
                  value={editValue}
                  onChange={setEditValue}
                  onKeyDown={handleKeyDown}
                  containerClassName="w-full"
                  className="font-mono"
                />
              )}
              {jsonError && (
                <p className="text-[11px] text-danger mt-1.5">{jsonError}</p>
              )}
            </div>

            {/* Footer: actions */}
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-t border-border bg-bg-secondary/30 flex-shrink-0">
              <button
                type="button"
                onClick={setNull}
                className="text-[11px] text-muted hover:text-primary transition-colors px-1.5 py-0.5"
                title="Set this cell to NULL"
              >
                Set NULL
              </button>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onCancel}
                  className="px-2.5 py-1 text-[11px] font-medium text-secondary hover:text-primary hover:bg-bg-secondary rounded-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => save()}
                  className="px-2.5 py-1 text-[11px] font-medium text-[rgb(var(--accent-text))] bg-accent hover:bg-accent-hover rounded-sm transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
});

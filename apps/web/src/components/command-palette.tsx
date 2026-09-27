
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Input } from '@codellyson/justui/react';

export interface CommandAction {
  id: string;
  label: string;
  category?: string;
  /** Short hint like "⌘S" rendered on the right. Purely cosmetic. */
  shortcut?: string;
  /** When false, the action is hidden. Useful for context-dependent commands. */
  enabled?: boolean;
  run: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  actions: CommandAction[];
}

function fuzzyMatch(query: string, target: string): { matched: boolean; score: number } {
  if (!query) return { matched: true, score: 0 };
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t.startsWith(q)) return { matched: true, score: 0 };
  const subIdx = t.indexOf(q);
  if (subIdx >= 0) return { matched: true, score: 1 + subIdx };
  let qi = 0;
  let lastIdx = -1;
  let gaps = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      if (lastIdx >= 0) gaps += i - lastIdx - 1;
      lastIdx = i;
      qi++;
    }
  }
  if (qi === q.length) return { matched: true, score: 100 + gaps };
  return { matched: false, score: Infinity };
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, actions }) => {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  const visibleActions = useMemo(
    () => actions.filter((a) => a.enabled !== false),
    [actions]
  );

  const filtered = useMemo(() => {
    if (!query) return visibleActions.slice(0, 200);
    return visibleActions
      .map((a) => ({ action: a, ...fuzzyMatch(query, a.label) }))
      .filter((x) => x.matched)
      .sort((a, b) => a.score - b.score)
      .slice(0, 200)
      .map((x) => x.action);
  }, [visibleActions, query]);

  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(0);
  }, [filtered.length, activeIdx]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (!isOpen || typeof window === 'undefined') return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const action = filtered[activeIdx];
      if (action) {
        onClose();
        // Defer the run so close-side effects (focus, etc.) settle first.
        requestAnimationFrame(() => action.run());
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-black/50"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-xl bg-bg border border-border rounded-lg shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border">
          <Input
            ref={inputRef}
            value={query}
            onChange={(v) => {
              setQuery(v);
              setActiveIdx(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Run a command..."
            containerClassName="flex-1 min-w-0"
            className="bg-transparent border-0 focus-visible:ring-0 px-0 text-base"
          />
        </div>
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted">No matching commands.</div>
          ) : (
            filtered.map((action, idx) => (
              <button
                key={action.id}
                data-idx={idx}
                onClick={() => {
                  onClose();
                  requestAnimationFrame(() => action.run());
                }}
                onMouseEnter={() => setActiveIdx(idx)}
                className={`w-full px-4 py-2 flex items-center justify-between gap-3 text-left text-sm transition-colors ${
                  idx === activeIdx
                    ? 'bg-accent/10 text-primary'
                    : 'text-secondary hover:bg-bg-secondary/50'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {action.category && (
                    <span className="text-meta uppercase tracking-wide text-muted flex-shrink-0">
                      {action.category}
                    </span>
                  )}
                  <span className="truncate">{action.label}</span>
                </div>
                {action.shortcut && (
                  <kbd className="px-1.5 py-0.5 text-meta font-mono bg-bg-secondary border border-border rounded-sm text-muted flex-shrink-0">
                    {action.shortcut}
                  </kbd>
                )}
              </button>
            ))
          )}
        </div>
        <div className="px-4 py-2 border-t border-border bg-bg-secondary/40 text-meta text-muted flex items-center gap-3">
          <span><kbd className="px-1 py-0.5 bg-bg rounded-sm border border-border">↑↓</kbd> navigate</span>
          <span><kbd className="px-1 py-0.5 bg-bg rounded-sm border border-border">Enter</kbd> run</span>
          <span><kbd className="px-1 py-0.5 bg-bg rounded-sm border border-border">Esc</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body
  );
};

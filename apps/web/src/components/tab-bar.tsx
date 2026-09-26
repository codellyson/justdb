
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ContextMenu, useContextMenu, type ContextMenuEntry } from './ui/context-menu';
import { Pin, X } from 'lucide-react';
import { Tooltip } from '@codellyson/justui/react';

export interface Tab {
  id: string;
  label: string;
  type: 'table' | 'view' | 'matview' | 'query' | 'editor';
  pinned?: boolean;
}

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | undefined;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabCloseOthers?: (tabId: string) => void;
  onTabCloseAll?: () => void;
  onTabReorder?: (fromId: string, toId: string) => void;
  onTabTogglePin?: (tabId: string) => void;
  actions?: React.ReactNode;
}

const TYPE_BADGE: Record<Tab['type'], string> = {
  query: 'Q',
  editor: 'E',
  table: 'T',
  view: 'V',
  matview: 'MV',
};

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onTabCloseOthers,
  onTabCloseAll,
  onTabReorder,
  onTabTogglePin,
  actions,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeElRef = useRef<HTMLButtonElement | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const tabRefs = useRef<Record<string, HTMLElement | null>>({});
  const [overflowIds, setOverflowIds] = useState<Set<string>>(new Set());
  const { menu, show, close } = useContextMenu();
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const overflowAnchorRef = useRef<HTMLButtonElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  // Pinned tabs first; preserve user-set order within each group.
  const ordered = useMemo(() => {
    const pinned = tabs.filter((t) => t.pinned);
    const rest = tabs.filter((t) => !t.pinned);
    return [...pinned, ...rest];
  }, [tabs]);

  // Scroll active tab into view.
  useEffect(() => {
    activeElRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest', inline: 'nearest' });
  }, [activeTabId]);

  useLayoutEffect(() => {
    const root = scrollRef.current;
    const active = activeTabId ? tabRefs.current[activeTabId] : null;
    if (!root || !active) { setIndicator({ left: 0, width: 0 }); return; }
    const measure = () => {
      const bounds = active.getBoundingClientRect();
      const rail = root.getBoundingClientRect();
      setIndicator({ left: bounds.left - rail.left + root.scrollLeft, width: bounds.width });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    for (const element of Object.values(tabRefs.current)) if (element) observer.observe(element);
    return () => observer.disconnect();
  }, [activeTabId, ordered]);

  // Track which tabs are not fully visible in the scroll container so the
  // overflow `…` button can list them. Re-runs on resize and when tabs change.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    let frame = 0;
    const compute = () => {
      const next = new Set<string>();
      const r = root.getBoundingClientRect();
      for (const tab of ordered) {
        const el = tabRefs.current[tab.id];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.right > r.right + 1 || rect.left < r.left - 1) next.add(tab.id);
      }
      setOverflowIds(previous => previous.size === next.size && [...next].every(id => previous.has(id)) ? previous : next);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; compute(); });
    };
    compute();
    const ro = new ResizeObserver(schedule);
    ro.observe(root);
    root.addEventListener('scroll', schedule, { passive: true });
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
      root.removeEventListener('scroll', schedule);
    };
  }, [ordered]);

  if (tabs.length === 0 && !actions) return null;

  const handleMiddleClick = (e: React.MouseEvent, tabId: string) => {
    if (e.button === 1) {
      e.preventDefault();
      onTabClose(tabId);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, tab: Tab) => {
    e.preventDefault();
    const items: ContextMenuEntry[] = [];
    if (onTabTogglePin) {
      items.push({
        label: tab.pinned ? 'Unpin' : 'Pin tab',
        onClick: () => onTabTogglePin(tab.id),
      });
      items.push({ type: 'divider' });
    }
    items.push({ label: 'Close', onClick: () => onTabClose(tab.id) });
    if (onTabCloseOthers) {
      items.push({ label: 'Close others', onClick: () => onTabCloseOthers(tab.id) });
    }
    if (onTabCloseAll) {
      items.push({ label: 'Close all', onClick: onTabCloseAll });
    }
    show(e, items);
  };

  const handleDragStart = (e: React.DragEvent, tabId: string) => {
    if (!onTabReorder) return;
    dragIdRef.current = tabId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tabId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!onTabReorder || !dragIdRef.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    if (!onTabReorder) return;
    e.preventDefault();
    const fromId = dragIdRef.current;
    dragIdRef.current = null;
    if (!fromId || fromId === targetId) return;
    onTabReorder(fromId, targetId);
  };

  return (
    <div className="flex items-center border-b border-border bg-bg-secondary/30 min-h-[36px]">
      {actions && (
        <div className="flex items-center px-1 border-r border-border flex-shrink-0 self-stretch">
          {actions}
        </div>
      )}
      <div
        ref={scrollRef}
        className="relative flex items-stretch overflow-x-auto scrollbar-none flex-1"
        role="tablist"
      >
        {ordered.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isPinned = !!tab.pinned;
          return (
            <Tooltip key={tab.id} label={tab.label}>
              <button
                ref={(el) => {
                  tabRefs.current[tab.id] = el;
                  if (isActive) activeElRef.current = el;
                }}
                role="tab"
                aria-selected={isActive}
                draggable={!!onTabReorder}
                onDragStart={(e) => handleDragStart(e, tab.id)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, tab.id)}
                onClick={() => onTabSelect(tab.id)}
                onMouseDown={(e) => handleMiddleClick(e, tab.id)}
                onContextMenu={(e) => handleContextMenu(e, tab)}
                className={`group relative flex items-center gap-1.5 ${isPinned ? 'px-2' : 'px-3'} py-2 text-xs font-medium border-r border-border whitespace-nowrap transition-colors ${
                  isPinned ? 'max-w-[80px]' : 'max-w-[180px]'
                } ${
                  isActive
                    ? 'bg-bg text-primary'
                    : 'text-muted hover:text-secondary hover:bg-bg-secondary/50'
                }`}
              >
                {isPinned && (
                  <Pin className="h-3 w-3 text-warning flex-shrink-0" aria-label="Pinned" />
                )}
                <span
                  className={`flex-shrink-0 font-mono text-meta px-1 py-px rounded-sm ${
                    isActive ? 'bg-accent/10 text-accent' : 'bg-bg-secondary text-muted'
                  }`}
                >
                  {TYPE_BADGE[tab.type]}
                </span>
                {!isPinned && <span className="truncate">{tab.label}</span>}
                {!isPinned && (
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(e) => { e.stopPropagation(); onTabClose(tab.id); }}
                    className={`flex-shrink-0 p-0.5 rounded-sm hover:bg-danger/10 hover:text-danger transition-colors ${
                      isActive ? 'text-muted' : 'text-transparent group-hover:text-muted'
                    }`}
                    aria-label={`Close ${tab.label}`}
                  >
                    <X className="h-3 w-3" />
                  </span>
                )}
              </button>
            </Tooltip>
          );
        })}
        <span aria-hidden="true" className="workspace-tab-indicator" style={{ width: indicator.width, transform: `translateX(${indicator.left}px)` }} />
      </div>
      {overflowIds.size > 0 && (
        <div className="relative flex-shrink-0">
          <Tooltip label={`${overflowIds.size} more tab${overflowIds.size === 1 ? '' : 's'}`}>
            <button
              ref={overflowAnchorRef}
              onClick={() => setShowOverflowMenu((v) => !v)}
              className="px-2 py-1.5 text-muted hover:text-primary hover:bg-bg-secondary/50 text-xs transition-colors"
              aria-label="Overflow menu"
              aria-expanded={showOverflowMenu}
            >
              … <span className="font-mono">{overflowIds.size}</span>
            </button>
          </Tooltip>
          {showOverflowMenu && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setShowOverflowMenu(false)}
                aria-hidden="true"
              />
              <div className="absolute right-0 top-full mt-1 z-40 min-w-[200px] max-w-[300px] max-h-[60vh] overflow-y-auto bg-bg border border-border rounded-sm shadow-lg py-1">
                {ordered
                  .filter((t) => overflowIds.has(t.id))
                  .map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        onTabSelect(t.id);
                        setShowOverflowMenu(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-bg-secondary transition-colors ${
                        t.id === activeTabId ? 'text-accent' : 'text-secondary'
                      }`}
                    >
                      <span className="font-mono text-meta px-1 py-px rounded-sm bg-bg-secondary text-muted flex-shrink-0">
                        {TYPE_BADGE[t.type]}
                      </span>
                      <span className="truncate">{t.label}</span>
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>
      )}
      {tabs.length > 1 && onTabCloseAll && (
        <Tooltip label="Close all tabs">
          <button
            onClick={onTabCloseAll}
            className="flex-shrink-0 px-2 py-1.5 text-muted hover:text-primary text-meta hover:bg-bg-secondary/50 transition-colors"
            aria-label="Close all tabs"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={close} />}
    </div>
  );
};

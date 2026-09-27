
import React, { useState, useRef, useCallback, useMemo } from 'react';
import { ContextMenu, useContextMenu, type ContextMenuEntry } from './ui/context-menu';
import { fuzzyMatch } from '@/lib/fuzzy';
import { Pin, Search, Table2, X } from 'lucide-react';
import { Input } from '@codellyson/justui/react';

interface TableListProps {
  tables: string[];
  selectedTable?: string;
  onSelect: (table: string) => void;
  onViewStructure?: (table: string) => void;
  onExportTable?: (table: string) => void;
  onOpenInQuery?: (table: string) => void;
  onDropTable?: (table: string) => void;
  // Prefs from useTableListPrefs.
  pinned?: string[];
  recent?: string[];
  onTogglePin?: (table: string) => void;
  groupByPrefix?: boolean;
  onToggleGroupByPrefix?: () => void;
  rowCounts?: Record<string, number | undefined>;
}

interface PrefixGroup {
  prefix: string;
  tables: string[];
}

/**
 * Auto-detect prefix groups: any prefix shared by 2+ tables (case-sensitive,
 * must be at least 3 chars and end at a non-alnum boundary or a CamelCase
 * boundary). Tables that don't fit any group go into an "Other" bucket.
 */
function groupByPrefix(tables: string[]): PrefixGroup[] {
  if (tables.length === 0) return [];
  const sorted = [...tables].sort();
  const groups: PrefixGroup[] = [];
  let i = 0;
  while (i < sorted.length) {
    const a = sorted[i];
    let j = i + 1;
    let common = a;
    while (j < sorted.length) {
      const next = commonPrefix(common, sorted[j]);
      // Trim back to a sensible boundary so we don't end mid-word.
      const trimmed = trimToBoundary(next);
      if (trimmed.length < 3) break;
      common = trimmed;
      j++;
    }
    if (j - i >= 2 && trimToBoundary(common).length >= 3) {
      groups.push({ prefix: trimToBoundary(common), tables: sorted.slice(i, j) });
      i = j;
    } else {
      // Single table — push to "Other" later.
      i++;
    }
  }

  // Re-bucket: tables not picked up above go into "Other".
  const claimed = new Set(groups.flatMap((g) => g.tables));
  const other = sorted.filter((t) => !claimed.has(t));
  if (other.length > 0) groups.push({ prefix: 'Other', tables: other });
  return groups;
}

function commonPrefix(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, i);
}

function trimToBoundary(s: string): string {
  // Trim back to the last non-alnum boundary or CamelCase boundary so the
  // group label reads naturally (e.g. "CommerceAgent" not "CommerceA").
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s[i];
    if (!/[A-Za-z0-9]/.test(c)) return s.slice(0, i);
    // CamelCase: capital following a lowercase
    if (i > 0 && /[a-z]/.test(s[i - 1]) && /[A-Z]/.test(c)) return s.slice(0, i);
    // snake_case: underscore boundary already handled above
  }
  return s;
}

function formatCount(n: number | undefined): string | null {
  // Defensive: drop any negative sentinels (e.g. Postgres reltuples = -1
  // for never-analyzed tables) that escape the provider layer.
  if (n === undefined || n === null || n < 0) return null;
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
}

const TableButton: React.FC<{
  table: string;
  selected: boolean;
  pinned?: boolean;
  count?: number;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onFocus?: () => void;
  tabIndex: number;
  buttonRef?: (el: HTMLButtonElement | null) => void;
}> = ({ table, selected, pinned, count, onSelect, onContextMenu, onFocus, tabIndex, buttonRef }) => {
  const countLabel = formatCount(count);
  return (
    <button
      ref={buttonRef}
      onClick={onSelect}
      onFocus={onFocus}
      onContextMenu={onContextMenu}
      tabIndex={tabIndex}
      className={`group w-full text-left px-2.5 py-1.5 text-[13px] rounded-md transition-colors duration-150 focus:outline-hidden focus:ring-1 focus:ring-accent/40 flex items-center gap-2 ${
        selected
          ? 'bg-accent/10 text-accent font-medium shadow-xs shadow-accent/5'
          : 'text-secondary hover:text-primary hover:bg-bg-secondary'
      }`}
      title={table}
    >
      {pinned && (
        <Pin className="h-3 w-3 text-warning flex-shrink-0" aria-label="Pinned" />
      )}
      <Table2 className={`h-3.5 w-3.5 flex-shrink-0 transition-colors ${
          selected ? 'text-accent' : 'text-muted group-hover:text-secondary'
        }`} />
      <span className="truncate flex-1">{table}</span>
      {countLabel !== null && (
        <span className="text-meta text-muted flex-shrink-0 font-mono">{countLabel}</span>
      )}
    </button>
  );
};

export const TableList: React.FC<TableListProps> = ({
  tables,
  selectedTable,
  onSelect,
  onViewStructure,
  onExportTable,
  onOpenInQuery,
  onDropTable,
  pinned = [],
  recent = [],
  onTogglePin,
  groupByPrefix: groupByPrefixOn,
  onToggleGroupByPrefix,
  rowCounts,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const buttonRefs = useRef<HTMLButtonElement[]>([]);
  const { menu: contextMenu, show: showContextMenu, close: closeContextMenu } = useContextMenu();

  const handleTableContextMenu = (e: React.MouseEvent, table: string) => {
    const items: ContextMenuEntry[] = [
      { label: 'Copy name', onClick: () => navigator.clipboard.writeText(table) },
    ];
    if (onTogglePin) {
      items.push({
        label: pinned.includes(table) ? 'Unpin' : 'Pin to top',
        onClick: () => onTogglePin(table),
      });
    }
    if (onViewStructure) {
      items.push({ label: 'View structure', onClick: () => onViewStructure(table) });
    }
    if (onOpenInQuery) {
      items.push({ label: 'Open in query editor', onClick: () => onOpenInQuery(table) });
    }
    if (onExportTable) {
      items.push(
        { type: 'divider' },
        { label: 'Export table', onClick: () => onExportTable(table) },
      );
    }
    if (onDropTable) {
      items.push(
        { type: 'divider' },
        { label: 'Drop table', onClick: () => onDropTable(table), danger: true },
      );
    }
    showContextMenu(e, items);
  };

  // Fuzzy filter + rank when there's a search query. Otherwise show all.
  const filteredTables = useMemo(() => {
    if (!searchQuery) return tables;
    return tables
      .map((t) => ({ table: t, ...fuzzyMatch(searchQuery, t) }))
      .filter((x) => x.matched)
      .sort((a, b) => a.score - b.score)
      .map((x) => x.table);
  }, [tables, searchQuery]);

  const isSearching = searchQuery.length > 0;
  const pinnedSet = useMemo(() => new Set(pinned), [pinned]);
  const recentVisible = useMemo(
    () => (isSearching ? [] : recent.filter((t) => tables.includes(t) && !pinnedSet.has(t))),
    [recent, tables, pinnedSet, isSearching]
  );
  const pinnedVisible = useMemo(
    () => (isSearching ? [] : pinned.filter((t) => tables.includes(t))),
    [pinned, tables, isSearching]
  );

  // Main list excludes pinned (which appear in the pinned section).
  const mainTables = useMemo(() => {
    if (isSearching) return filteredTables;
    return filteredTables.filter((t) => !pinnedSet.has(t));
  }, [filteredTables, pinnedSet, isSearching]);

  const groups = useMemo(() => {
    if (!groupByPrefixOn || isSearching) return null;
    return groupByPrefix(mainTables);
  }, [mainTables, groupByPrefixOn, isSearching]);

  // Build the flat sequence of focusable tables (in render order). Used by
  // keyboard navigation so arrow keys cross sections naturally.
  const flatOrder = useMemo(() => {
    const arr: string[] = [];
    if (pinnedVisible.length > 0) arr.push(...pinnedVisible);
    if (recentVisible.length > 0) arr.push(...recentVisible);
    if (groups) {
      for (const g of groups) {
        if (!collapsedGroups.has(g.prefix)) arr.push(...g.tables);
      }
    } else {
      arr.push(...mainTables);
    }
    return arr;
  }, [pinnedVisible, recentVisible, groups, collapsedGroups, mainTables]);

  const focusAt = useCallback((idx: number) => {
    setFocusedIndex(idx);
    buttonRefs.current[idx]?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (flatOrder.length === 0) return;
      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const next = focusedIndex < flatOrder.length - 1 ? focusedIndex + 1 : 0;
          focusAt(next);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prev = focusedIndex > 0 ? focusedIndex - 1 : flatOrder.length - 1;
          focusAt(prev);
          break;
        }
        case 'Enter': {
          if (focusedIndex >= 0 && focusedIndex < flatOrder.length) {
            onSelect(flatOrder[focusedIndex]);
          }
          break;
        }
        case 'Home': {
          e.preventDefault();
          focusAt(0);
          break;
        }
        case 'End': {
          e.preventDefault();
          focusAt(flatOrder.length - 1);
          break;
        }
      }
    },
    [flatOrder, focusedIndex, onSelect, focusAt]
  );

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' && flatOrder.length > 0) {
      e.preventDefault();
      focusAt(0);
    }
  };

  // Reset refs each render (we'll re-collect during list rendering).
  buttonRefs.current = [];

  let buttonIdx = 0;
  const collectRef = (table: string) => (el: HTMLButtonElement | null) => {
    void table;
    if (el) buttonRefs.current[buttonIdx++] = el;
  };

  const renderRow = (table: string) => {
    const idx = buttonIdx;
    return (
      <li key={table} role="option" aria-selected={selectedTable === table}>
        <TableButton
          table={table}
          selected={selectedTable === table}
          pinned={pinnedSet.has(table)}
          count={rowCounts?.[table]}
          onSelect={() => onSelect(table)}
          onContextMenu={(e) => handleTableContextMenu(e, table)}
          onFocus={() => setFocusedIndex(idx)}
          tabIndex={focusedIndex === idx ? 0 : -1}
          buttonRef={collectRef(table)}
        />
      </li>
    );
  };

  const toggleGroup = (prefix: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(prefix)) next.delete(prefix);
      else next.add(prefix);
      return next;
    });
  };

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted pointer-events-none" />
          <Input
            placeholder="Search tables..."
            value={searchQuery}
            onChange={(v) => { setSearchQuery(v); setFocusedIndex(-1); }}
            onKeyDown={handleSearchKeyDown}
            containerClassName="w-full"
            className="pl-8 text-xs bg-bg-secondary/50"
            aria-label="Search tables"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); setFocusedIndex(-1); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-primary transition-colors"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        {onToggleGroupByPrefix && (
          <button
            onClick={onToggleGroupByPrefix}
            className={`px-1.5 py-1 text-meta font-medium rounded-sm transition-colors ${
              groupByPrefixOn ? 'bg-accent/15 text-accent' : 'text-muted hover:text-primary hover:bg-bg-secondary'
            }`}
            title="Group tables by prefix"
            aria-pressed={!!groupByPrefixOn}
          >
            Group
          </button>
        )}
      </div>

      <ul ref={(_el) => undefined} className="space-y-px" role="listbox" aria-label="Tables" onKeyDown={handleKeyDown}>
        {pinnedVisible.length > 0 && (
          <>
            <li className="text-meta uppercase tracking-wide text-muted px-2 pt-1 pb-0.5">Pinned</li>
            {pinnedVisible.map((t) => renderRow(t))}
          </>
        )}
        {recentVisible.length > 0 && (
          <>
            <li className="text-meta uppercase tracking-wide text-muted px-2 pt-2 pb-0.5">Recent</li>
            {recentVisible.map((t) => renderRow(t))}
          </>
        )}

        {(pinnedVisible.length > 0 || recentVisible.length > 0) && (
          <li className="text-meta uppercase tracking-wide text-muted px-2 pt-2 pb-0.5">
            {isSearching ? 'Results' : 'All tables'}
          </li>
        )}

        {groups ? (
          groups.map((g) => (
            <React.Fragment key={g.prefix}>
              <li>
                <button
                  onClick={() => toggleGroup(g.prefix)}
                  className="w-full flex items-center gap-1 px-2 py-1 text-meta font-medium text-secondary hover:text-primary transition-colors"
                >
                  <span className="font-mono text-muted">
                    {collapsedGroups.has(g.prefix) ? '▸' : '▾'}
                  </span>
                  <span className="truncate">{g.prefix}</span>
                  <span className="text-muted ml-auto">{g.tables.length}</span>
                </button>
              </li>
              {!collapsedGroups.has(g.prefix) && g.tables.map((t) => renderRow(t))}
            </React.Fragment>
          ))
        ) : (
          mainTables.map((t) => renderRow(t))
        )}

        {flatOrder.length === 0 && (
          <li className="text-xs text-muted px-3 py-4 text-center">
            {isSearching ? `No tables matching "${searchQuery}"` : 'No tables.'}
          </li>
        )}
      </ul>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
};

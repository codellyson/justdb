// Lean grid for the SQL editor result tab.
//
// The DataTable used by the table-browse view does too much for SQL results:
// 200 rows × 16+ cols means one `setSelectedCell` re-renders ~3,200 cells
// inside the parent component, even though EditableCell is memo'd — because
// the parent recreates callbacks and prop objects each render and busts the
// memo.
//
// This component keeps interaction state OUTSIDE the React render tree
// (external stores subscribed via useSyncExternalStore) so that a click on
// one cell re-renders only the previously-selected and newly-selected
// cells. Column widths/order/frozen are similarly held in a store and
// applied via CSS custom properties on the scroll container, so a drag-
// resize does not re-render a single cell — only the container's inline
// style attribute changes.

import React, {
  createContext,
  forwardRef,
  memo,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { Checkbox } from '@codellyson/justui/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CellDisplay, EditableCell, type SaveIntent } from './editable-cell';
import { ContextMenu, useContextMenu, type ContextMenuEntry } from './ui/context-menu';
import { TableSkeleton } from './skeletons/table-skeleton';
import { SmartCellDisplay } from './smart-cell-display';
import { FormattedCell } from './formatted-cell';
import { ColumnFilterPopover } from './column-filter-popover';
import { applyFormatter } from '@/lib/formatter-presets';
import type { Filter } from '@/lib/filters';
import type { ColumnFormatter } from '@/lib/plugin-types';
import {
  usePendingChanges,
  rowKeyFromPks,
  type TablePending,
} from '@/contexts/pending-changes-context';
import type { ColumnInfo } from '@/types';
import { ArrowUpRight, Check, ChevronUp, Copy, Eye, Maximize2, PencilLine, X } from 'lucide-react';

const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 40;
const DEFAULT_COL_WIDTH = 180;
const MIN_COL_WIDTH = 60;
const MAX_COL_WIDTH = 800;
const CHECKBOX_WIDTH = 28;

function defaultWidthForType(type?: string): number {
  if (!type) return DEFAULT_COL_WIDTH;
  const t = type.toLowerCase();
  if (t.includes('bool')) return 80;
  if (t === 'integer' || t === 'int' || t === 'smallint' || t === 'bigint' || t.includes('serial')) return 100;
  if (t === 'numeric' || t === 'decimal' || t === 'real' || t === 'float' || t.includes('double')) return 120;
  if (t === 'date') return 110;
  if (t.startsWith('timestamp') || t === 'datetime') return 200;
  if (t === 'uuid') return 280;
  if (t === 'json' || t === 'jsonb') return 240;
  if (t === 'text' || t.includes('varchar') || t.includes('char')) return 200;
  return DEFAULT_COL_WIDTH;
}

export interface ForeignKeyTarget {
  schema: string;
  table: string;
  column: string;
}

export interface ForeignKeyClickArgs {
  sourceColumn: string;
  fk: ForeignKeyTarget;
  value: any;
}

export interface QueryResultGridProps {
  columns: string[];
  data: any[];
  isLoading?: boolean;
  isRefreshing?: boolean;
  /** Paging context for the empty state, mirroring the query that ran. */
  limit?: number;
  offset?: number;
  columnTypes?: Record<string, string>;
  searchQuery?: string;
  schema?: string;
  table?: string;
  primaryKeys?: string[];
  columnSchema?: ColumnInfo[];
  pksFromRow?: (row: any) => Record<string, any>;
  columnToSource?: Record<string, string>;
  onCellUpdate?: (args: {
    pks: Record<string, any>;
    column: string;
    original: any;
    next: any;
  }) => void;
  onRowDelete?: (args: { pks: Record<string, any>; snapshot: Record<string, any> }) => void;
  readOnlyColumns?: string[];
  foreignKeys?: Record<string, ForeignKeyTarget>;
  onForeignKeyClick?: (args: ForeignKeyClickArgs) => void;
  onSort?: (column: string) => void;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  /** Show only these columns (in their original order), if provided. */
  visibleColumns?: string[];
  /** Active formatter plugins; the grid picks the first matcher that hits. */
  activeFormatters?: ColumnFormatter[];
  filters?: Filter[];
  onAddFilter?: (filter: Filter) => void;
  onRemoveFilter?: (column: string) => void;
  /** Follow the active grid cell into a row inspector. */
  onInspectRow?: (selection: { row: Record<string, any>; index: number } | null) => void;
  /** Vertical max-height for the scroll container. The default lands the
   *  grid below the table-browse chrome; the SQL editor needs more space
   *  reserved above for the SQL query card. Ignored when `fillParent` is set. */
  maxHeightCss?: string;
  /** Grow to fill a flex-column parent instead of capping at a viewport-
   *  relative max-height. The parent must be `flex flex-col min-h-0`. */
  fillParent?: boolean;
  /** Called with the snapshot rows backing the currently-selected row keys. */
  onBulkExport?: (rows: any[]) => void;
  /** Stable key for layout persistence; usually the SQL string. */
  layoutKey?: string;
}

export interface QueryResultGridHandle {
  /** Stage a new draft row at the top and bring it into view. */
  addRecord: () => void;
  clearActiveCell: () => void;
  inspectFirstRow: () => void;
}

// ─── External stores ─────────────────────────────────────────────────────

type CellAddr = { rowIndex: number; col: string } | null;

class CellAddrStore {
  private state: CellAddr = null;
  private listeners = new Set<() => void>();
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  get = (): CellAddr => this.state;
  set(next: CellAddr) {
    const prev = this.state;
    if (prev === next) return;
    if (prev && next && prev.rowIndex === next.rowIndex && prev.col === next.col) return;
    this.state = next;
    this.listeners.forEach((l) => l());
  }
}

class RowIndexStore {
  private state: number | null = null;
  private listeners = new Set<() => void>();
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  get = (): number | null => this.state;
  set(next: number | null) {
    if (this.state === next) return;
    this.state = next;
    this.listeners.forEach((l) => l());
  }
  toggle(next: number) {
    this.set(this.state === next ? null : next);
  }
}

class RowKeySetStore {
  private state = new Set<string>();
  private listeners = new Set<() => void>();
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  get = (): ReadonlySet<string> => this.state;
  add(key: string) {
    if (this.state.has(key)) return;
    const next = new Set(this.state);
    next.add(key);
    this.state = next;
    this.listeners.forEach((l) => l());
  }
  remove(key: string) {
    if (!this.state.has(key)) return;
    const next = new Set(this.state);
    next.delete(key);
    this.state = next;
    this.listeners.forEach((l) => l());
  }
  toggle(key: string) {
    if (this.state.has(key)) this.remove(key);
    else this.add(key);
  }
  setMany(keys: string[]) {
    const next = new Set(this.state);
    for (const k of keys) next.add(k);
    if (next.size === this.state.size) return;
    this.state = next;
    this.listeners.forEach((l) => l());
  }
  clear() {
    if (this.state.size === 0) return;
    this.state = new Set();
    this.listeners.forEach((l) => l());
  }
}

interface Layout {
  widths: Record<string, number>;
  order: string[] | null;
  frozen: string | null;
}

class LayoutStore {
  private state: Layout = { widths: {}, order: null, frozen: null };
  private listeners = new Set<() => void>();
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  get = (): Layout => this.state;
  hydrate(next: Layout) {
    this.state = next;
    this.listeners.forEach((l) => l());
  }
  setWidth(col: string, width: number) {
    const w = Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, width));
    if (this.state.widths[col] === w) return;
    this.state = { ...this.state, widths: { ...this.state.widths, [col]: w } };
    this.listeners.forEach((l) => l());
  }
  resetWidth(col: string) {
    if (!(col in this.state.widths)) return;
    const nextWidths = { ...this.state.widths };
    delete nextWidths[col];
    this.state = { ...this.state, widths: nextWidths };
    this.listeners.forEach((l) => l());
  }
  setOrder(order: string[] | null) {
    this.state = { ...this.state, order };
    this.listeners.forEach((l) => l());
  }
  setFrozen(frozen: string | null) {
    if (this.state.frozen === frozen) return;
    this.state = { ...this.state, frozen };
    this.listeners.forEach((l) => l());
  }
}

interface Stores {
  selection: CellAddrStore;
  editing: CellAddrStore;
  /** Which cell the pointer is over, so only that one renders its actions. */
  hovered: CellAddrStore;
  expanded: RowIndexStore;
  selectedRows: RowKeySetStore;
  layout: LayoutStore;
}

const StoresContext = createContext<Stores | null>(null);
function useStores(): Stores {
  const s = useContext(StoresContext);
  if (!s) throw new Error('QueryResultGrid stores not in context');
  return s;
}

// ─── Subscription hooks ──────────────────────────────────────────────────

function useIsHere(store: CellAddrStore, rowIndex: number, col: string): boolean {
  return useSyncExternalStore(store.subscribe, () => {
    const v = store.get();
    return !!(v && v.rowIndex === rowIndex && v.col === col);
  });
}

function useIsRowExpanded(store: RowIndexStore, rowIndex: number): boolean {
  return useSyncExternalStore(store.subscribe, () => store.get() === rowIndex);
}

function useIsActiveRow(store: CellAddrStore, rowIndex: number): boolean {
  return useSyncExternalStore(store.subscribe, () => store.get()?.rowIndex === rowIndex);
}

function useIsRowSelected(store: RowKeySetStore, key: string | null): boolean {
  return useSyncExternalStore(store.subscribe, () => (key ? store.get().has(key) : false));
}

function useLayout(store: LayoutStore): Layout {
  return useSyncExternalStore(store.subscribe, () => store.get());
}

// ─── Layout persistence ──────────────────────────────────────────────────

function useLayoutPersistence(layoutKey: string | undefined, store: LayoutStore) {
  // Hydrate once per layoutKey.
  const hydratedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!layoutKey || typeof window === 'undefined') return;
    if (hydratedRef.current === layoutKey) return;
    hydratedRef.current = layoutKey;
    try {
      const raw = localStorage.getItem(`justdb-qrg-${layoutKey}`);
      if (raw) {
        const parsed = JSON.parse(raw) as Layout;
        store.hydrate({
          widths: parsed.widths ?? {},
          order: Array.isArray(parsed.order) ? parsed.order : null,
          frozen: parsed.frozen ?? null,
        });
      } else {
        store.hydrate({ widths: {}, order: null, frozen: null });
      }
    } catch {
      // ignore
    }
  }, [layoutKey, store]);

  // Persist on layout change.
  useEffect(() => {
    if (!layoutKey || typeof window === 'undefined') return;
    let pending = 0;
    const unsub = store.subscribe(() => {
      window.clearTimeout(pending);
      pending = window.setTimeout(() => {
        try {
          localStorage.setItem(`justdb-qrg-${layoutKey}`, JSON.stringify(store.get()));
        } catch {
          // ignore
        }
      }, 250);
    });
    return () => {
      window.clearTimeout(pending);
      unsub();
    };
  }, [layoutKey, store]);
}

// ─── Main component ──────────────────────────────────────────────────────

export const QueryResultGrid = forwardRef<QueryResultGridHandle, QueryResultGridProps>(
  function QueryResultGrid(props, ref) {
  const {
    columns,
    data,
    isLoading,
    isRefreshing,
    limit,
    offset,
    columnTypes = {},
    searchQuery,
    schema,
    table,
    primaryKeys = [],
    columnSchema,
    pksFromRow,
    columnToSource,
    onCellUpdate,
    onRowDelete,
    readOnlyColumns,
    foreignKeys,
    onForeignKeyClick,
    onSort,
    sortColumn,
    sortDirection,
    visibleColumns,
    activeFormatters,
    filters,
    onAddFilter,
    onRemoveFilter,
    onInspectRow,
    maxHeightCss,
    fillParent,
    onBulkExport,
    layoutKey,
  } = props;
  const storesRef = useRef<Stores | null>(null);
  if (storesRef.current === null) {
    storesRef.current = {
      selection: new CellAddrStore(),
      editing: new CellAddrStore(),
      hovered: new CellAddrStore(),
      expanded: new RowIndexStore(),
      selectedRows: new RowKeySetStore(),
      layout: new LayoutStore(),
    };
  }
  const stores = storesRef.current;

  useLayoutPersistence(layoutKey, stores.layout);

  const canEdit = primaryKeys.length > 0 && !!onCellUpdate;
  const readOnlyColumnSet = useMemo(() => new Set(readOnlyColumns ?? []), [readOnlyColumns]);

  const pending = usePendingChanges();
  const tablePending = schema && table ? pending.getPending(schema, table) : null;
  // Keep refs to the pending mutators so cell-menu builders don't have to
  // chase context through their own dep arrays.
  const unstageEdit = pending.unstageEdit;
  const unstageDelete = pending.unstageDelete;
  const stageInsert = pending.stageInsert;
  const updateInsert = pending.updateInsert;
  const unstageInsert = pending.unstageInsert;

  // canInsert: the editable result resolves to a single (schema, table) so
  // we know where to send the staged insert. When false, no inline insert
  // row is rendered.
  const canInsert = canEdit && !!schema && !!table;

  // What an untouched draft cell will send: the column default when it has
  // one, otherwise NULL.
  const columnDefaults = useMemo(() => {
    const map: Record<string, 'DEFAULT' | 'NULL'> = {};
    for (const col of columnSchema ?? []) {
      map[col.name] = col.default != null ? 'DEFAULT' : 'NULL';
    }
    return map;
  }, [columnSchema]);
  const stagedInserts = tablePending?.inserts ?? [];

  const getRowPks = useCallback(
    (row: any): Record<string, any> => {
      if (pksFromRow) return pksFromRow(row);
      const out: Record<string, any> = {};
      for (const pk of primaryKeys) out[pk] = row[pk];
      return out;
    },
    [pksFromRow, primaryKeys],
  );

  const filteredData = useMemo(() => {
    if (!searchQuery || !searchQuery.trim()) return data;
    const q = searchQuery.toLowerCase();
    return data.filter((row) =>
      columns.some((c) => {
        const v = row[c];
        if (v === null || v === undefined) return false;
        return String(v).toLowerCase().includes(q);
      }),
    );
  }, [data, columns, searchQuery]);

  // displayColumns = stored order ∩ available columns, with any new columns
  // appended in their original position so a tab swap doesn't lose newly-
  // appearing data columns.
  const layout = useLayout(stores.layout);
  // visibleColumns trims the candidate set before applying the user-stored
  // order so a hidden column stays hidden even if it appears in the order.
  const candidateColumns = useMemo(() => {
    if (!visibleColumns) return columns;
    const set = new Set(visibleColumns);
    return columns.filter((c) => set.has(c));
  }, [columns, visibleColumns]);
  const displayColumns = useMemo(() => {
    if (!layout.order) return candidateColumns;
    const inOrder = layout.order.filter((c) => candidateColumns.includes(c));
    const missing = candidateColumns.filter((c) => !inOrder.includes(c));
    return [...inOrder, ...missing];
  }, [candidateColumns, layout.order]);

  // Pick the first formatter whose matcher hits a given column. Memoized
  // per column so cells receive a stable ref.
  const formatterByColumn = useMemo(() => {
    const out: Record<string, ColumnFormatter> = {};
    if (!activeFormatters || activeFormatters.length === 0) return out;
    for (const c of columns) {
      const colType = (columnTypes[c] || '').toLowerCase();
      const hit = activeFormatters.find((f) => {
        const val = f.matcher.value.toLowerCase();
        switch (f.matcher.type) {
          case 'data-type':
            return colType.startsWith(val);
          case 'column-name':
            return c.toLowerCase() === val;
          case 'column-name-pattern':
            try {
              return new RegExp(f.matcher.value, 'i').test(c);
            } catch {
              return false;
            }
          default:
            return false;
        }
      });
      if (hit) out[c] = hit;
    }
    return out;
  }, [activeFormatters, columns, columnTypes]);

  // Resolved per-column widths: stored override → default-for-type.
  const resolvedWidths = useMemo(() => {
    const w: Record<string, number> = {};
    for (const c of displayColumns) w[c] = layout.widths[c] ?? defaultWidthForType(columnTypes[c]);
    return w;
  }, [displayColumns, layout.widths, columnTypes]);

  // CSS vars on the container expose each column's width as --cw-<idx>.
  // Cells use width: var(--cw-N), so width changes don't re-render a single
  // cell — only the container's inline style attribute updates.
  const widthVars = useMemo(() => {
    const vars: Record<string, string> = {};
    displayColumns.forEach((c, i) => {
      vars[`--cw-${i}`] = `${resolvedWidths[c]}px`;
    });
    return vars;
  }, [displayColumns, resolvedWidths]);

  const totalDataWidth = useMemo(
    () => displayColumns.reduce((sum, c) => sum + resolvedWidths[c], 0),
    [displayColumns, resolvedWidths],
  );

  // Frozen column's effective left offset (after row-number + checkbox).
  const frozenLeft = canEdit ? CHECKBOX_WIDTH : 0;

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  // Expanded rows are dynamically sized; default rows stay at ROW_HEIGHT.
  // measureElement is only wired in when at least one row is expanded so the
  // virtualizer doesn't pay the ResizeObserver cost on every row otherwise.
  const expandedIdx = useSyncExternalStore(stores.expanded.subscribe, () =>
    stores.expanded.get(),
  );
  const measureElement = useMemo(
    () => (expandedIdx !== null ? (el: Element) => el.getBoundingClientRect().height : undefined),
    [expandedIdx],
  );
  // Drafts lead the virtual list, so a new record appears where the user is
  // looking rather than below however many rows are loaded.
  const draftCount = stagedInserts.length;
  const totalVirtualRows = draftCount + filteredData.length;
  const rowVirtualizer = useVirtualizer({
    count: totalVirtualRows,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    measureElement,
    // The sticky header covers the top HEADER_HEIGHT of the scroll
    // container. Without this, scrollToIndex(0) lands at scrollTop=0 and
    // the first ~1.1 rows hide behind the header.
    scrollPaddingStart: HEADER_HEIGHT,
  });

  // ── Stable handlers ────────────────────────────────────────────────────

  const selectCell = useCallback(
    (rowIndex: number, col: string) => stores.selection.set({ rowIndex, col }),
    [stores],
  );
  const startEdit = useCallback(
    (rowIndex: number, col: string) => stores.editing.set({ rowIndex, col }),
    [stores],
  );
  const cancelEdit = useCallback(() => stores.editing.set(null), [stores]);

  const moveEdit = useCallback(
    (rowIndex: number, col: string, intent: SaveIntent): boolean => {
      if (!intent) return false;
      const colIdx = displayColumns.indexOf(col);
      if (colIdx < 0) return false;
      let nextRow = rowIndex;
      let nextCol = colIdx;
      if (intent === 'right') nextCol += 1;
      else if (intent === 'left') nextCol -= 1;
      else if (intent === 'down') nextRow += 1;
      if (
        nextRow < 0 ||
        nextRow >= totalVirtualRows ||
        nextCol < 0 ||
        nextCol >= displayColumns.length
      ) {
        return false;
      }
      stores.editing.set({ rowIndex: nextRow, col: displayColumns[nextCol] });
      return true;
    },
    [displayColumns, totalVirtualRows, stores],
  );

  /** Virtual index -> backing DB row; undefined for the leading drafts. */
  const rowAt = useCallback(
    (virtualIndex: number) => filteredData[virtualIndex - draftCount],
    [filteredData, draftCount],
  );

  useEffect(() => {
    if (!onInspectRow) return;
    const syncInspector = () => {
      const selected = stores.selection.get();
      const index = selected ? selected.rowIndex - draftCount : -1;
      const row = filteredData[index];
      onInspectRow(row ? { row, index } : null);
    };
    syncInspector();
    return stores.selection.subscribe(syncInspector);
  }, [stores, filteredData, draftCount, onInspectRow]);

  useEffect(() => {
    stores.selection.set(null);
  }, [stores, layoutKey, offset, filteredData]);

  const handleCellSave = useCallback(
    (rowIndex: number, col: string, originalValue: any, nextValue: any, intent?: SaveIntent) => {
      if (!onCellUpdate) return;
      const row = rowAt(rowIndex);
      if (!row) return;
      const pks = getRowPks(row);
      const baseColumn = columnToSource?.[col] ?? col;
      onCellUpdate({ pks, column: baseColumn, original: originalValue, next: nextValue });
      if (!moveEdit(rowIndex, col, intent ?? null)) {
        stores.editing.set(null);
      }
    },
    [onCellUpdate, rowAt, getRowPks, columnToSource, moveEdit, stores],
  );

  const handleRowDelete = useCallback(
    (rowIndex: number) => {
      if (!onRowDelete) return;
      const row = rowAt(rowIndex);
      if (!row) return;
      const pks = getRowPks(row);
      onRowDelete({ pks, snapshot: row });
    },
    [onRowDelete, filteredData, getRowPks],
  );

  // Insert flow handlers. Each takes a virtual rowIndex (where the empty
  // row + staged inserts live AFTER the data rows) and routes the save to
  // the right pending-changes mutator.

  const handleStagedInsertSave = useCallback(
    (tempId: string, col: string, value: any, intent?: SaveIntent) => {
      if (!schema || !table) return;
      updateInsert({ schema, table, tempId, column: col, value });
      // For now we close the editor on save instead of chasing intent
      // movement across the heterogeneous row stack.
      void intent;
      stores.editing.set(null);
    },
    [schema, table, updateInsert, stores],
  );


  const handleDiscardInsert = useCallback(
    (tempId: string) => {
      if (!schema || !table) return;
      unstageInsert({ schema, table, tempId });
    },
    [schema, table, unstageInsert],
  );

  const fkClick = useCallback(
    (sourceColumn: string, fk: ForeignKeyTarget, value: any) => {
      onForeignKeyClick?.({ sourceColumn, fk, value });
    },
    [onForeignKeyClick],
  );

  const toggleRowExpanded = useCallback(
    (rowIndex: number) => stores.expanded.toggle(rowIndex),
    [stores],
  );

  // Bulk-select: maintain last-clicked row index for shift-range extension.
  const lastClickedRef = useRef<number | null>(null);
  const toggleRowSelected = useCallback(
    (rowIndex: number, rowKey: string, shift: boolean) => {
      if (shift && lastClickedRef.current != null) {
        const from = Math.min(lastClickedRef.current, rowIndex);
        const to = Math.max(lastClickedRef.current, rowIndex);
        const keys: string[] = [];
        for (let i = from; i <= to; i++) {
          const r = filteredData[i];
          if (!r) continue;
          keys.push(rowKeyFromPks(getRowPks(r)));
        }
        stores.selectedRows.setMany(keys);
      } else {
        stores.selectedRows.toggle(rowKey);
        lastClickedRef.current = rowIndex;
      }
    },
    [filteredData, getRowPks, stores],
  );

  // Materialize the rowKeys of every visible (filtered) row. Used by select-
  // all + bulk-delete. Cheap for the 200-row cap.
  const allRowKeys = useMemo(() => {
    if (!canEdit) return [] as string[];
    return filteredData.map((r) => rowKeyFromPks(getRowPks(r)));
  }, [canEdit, filteredData, getRowPks]);

  const selectAllVisible = useCallback(() => {
    stores.selectedRows.setMany(allRowKeys);
  }, [allRowKeys, stores]);

  const clearSelection = useCallback(() => stores.selectedRows.clear(), [stores]);

  const deleteSelected = useCallback(() => {
    if (!onRowDelete || !canEdit) return;
    const selected = stores.selectedRows.get();
    for (let i = 0; i < filteredData.length; i++) {
      const row = filteredData[i];
      const pks = getRowPks(row);
      const rk = rowKeyFromPks(pks);
      if (selected.has(rk)) onRowDelete({ pks, snapshot: row });
    }
    stores.selectedRows.clear();
  }, [onRowDelete, canEdit, filteredData, getRowPks, stores]);

  // ── Keyboard navigation ────────────────────────────────────────────────
  // Window-level so the user doesn't have to fiddle with focus. We bail
  // when an input/textarea/contenteditable is focused (so EditableCell
  // editors handle their own keys) and when the document focus is somewhere
  // unrelated to this grid.

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc takes priority over the typing/selection gates below: it should
      // dismiss whatever overlay the grid currently owns no matter where
      // focus is, including the right-click context menu and the column
      // filter popover. CodeMirror's default keymap can swallow Esc to
      // close its autocomplete popup, so we listen on the capture phase
      // (see addEventListener call below) and stopPropagation when we
      // consume the event ourselves.
      if (e.key === 'Escape') {
        let consumed = false;
        if (menuOpenRef.current) {
          closeMenu();
          consumed = true;
        }
        if (filterPopoverOpenRef.current) {
          setFilterPopover(null);
          consumed = true;
        }
        if (stores.editing.get()) {
          stores.editing.set(null);
          consumed = true;
        }
        if (!consumed && stores.selection.get()) {
          stores.selection.set(null);
          consumed = true;
        }
        if (consumed) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      const tgt = e.target as HTMLElement | null;
      if (
        tgt &&
        (tgt.tagName === 'INPUT' ||
          tgt.tagName === 'TEXTAREA' ||
          tgt.tagName === 'SELECT' ||
          tgt.isContentEditable)
      ) {
        return;
      }
      // Only respond when there is a current selection — otherwise arrows
      // would steal focus from any other surface on the page.
      const sel = stores.selection.get();
      if (!sel) return;
      // Editing cell owns its keys.
      if (stores.editing.get()) return;

      const colIdx = displayColumns.indexOf(sel.col);
      if (colIdx < 0) return;

      let nextRow = sel.rowIndex;
      let nextCol = colIdx;
      switch (e.key) {
        case 'ArrowUp':
          nextRow -= 1;
          break;
        case 'ArrowDown':
          nextRow += 1;
          break;
        case 'ArrowLeft':
          nextCol -= 1;
          break;
        case 'ArrowRight':
          nextCol += 1;
          break;
        case 'Enter':
          if (canEdit && !readOnlyColumnSet.has(sel.col)) {
            e.preventDefault();
            stores.editing.set({ rowIndex: sel.rowIndex, col: sel.col });
          }
          return;
        case 'Escape':
          stores.selection.set(null);
          return;
        default:
          return;
      }
      e.preventDefault();
      if (
        nextRow < 0 ||
        nextRow >= filteredData.length ||
        nextCol < 0 ||
        nextCol >= displayColumns.length
      ) {
        return;
      }
      stores.selection.set({ rowIndex: nextRow, col: displayColumns[nextCol] });
      rowVirtualizer.scrollToIndex(nextRow, { align: 'auto' });
    };
    // Capture phase so our handler runs before CodeMirror or any other
    // target-side keydown listener can consume Esc.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [stores, displayColumns, filteredData.length, canEdit, readOnlyColumnSet, rowVirtualizer]);

  // ── Filter popover ─────────────────────────────────────────────────────

  // Refs read by the window-level Esc handler; declared up here so both the
  // menu and popover sections can sync .current without TDZ issues.
  const menuOpenRef = useRef<boolean>(false);
  const filterPopoverOpenRef = useRef<boolean>(false);

  const [filterPopover, setFilterPopover] = useState<{
    column: string;
    anchor: DOMRect;
  } | null>(null);
  filterPopoverOpenRef.current = filterPopover !== null;

  // ── Context menus ──────────────────────────────────────────────────────

  const { menu, show: showMenu, close: closeMenu } = useContextMenu();
  menuOpenRef.current = !!menu;

  const onRowContext = useCallback(
    (e: React.MouseEvent, rowIndex: number) => {
      const isExpanded = stores.expanded.get() === rowIndex;
      const items: ContextMenuEntry[] = [
        {
          label: isExpanded ? 'Collapse row' : 'Expand row',
          onClick: () => stores.expanded.toggle(rowIndex),
        },
        {
          label: 'Copy row as JSON',
          onClick: () => {
            const row = rowAt(rowIndex);
            if (!row) return;
            void navigator.clipboard.writeText(JSON.stringify(row, null, 2));
          },
        },
      ];
      if (canEdit) {
        items.push({ type: 'divider' });
        items.push({
          label: 'Delete row',
          danger: true,
          onClick: () => handleRowDelete(rowIndex),
        });
      }
      showMenu(e, items);
    },
    [stores, rowAt, canEdit, handleRowDelete, showMenu],
  );

  const onCellContext = useCallback(
    (e: React.MouseEvent, rowIndex: number, col: string, value: any) => {
      const row = rowAt(rowIndex);
      if (!row) return;
      const editable = canEdit && !readOnlyColumnSet.has(col);
      const baseColumn = columnToSource?.[col] ?? col;
      const rowPks = canEdit ? getRowPks(row) : null;
      const rowKey = rowPks ? rowKeyFromPks(rowPks) : null;
      const stagedEdit = rowKey ? tablePending?.edits[rowKey] : undefined;
      const stagedDelete = rowKey ? tablePending?.deletes[rowKey] : undefined;
      const isCellStaged = !!stagedEdit?.changes[baseColumn];

      const valueStr =
        value === null || value === undefined
          ? 'NULL'
          : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value);
      const rowJson = JSON.stringify(row, null, 2);

      const items: ContextMenuEntry[] = [
        { label: 'Copy value', onClick: () => void navigator.clipboard.writeText(valueStr) },
        { label: 'Copy row as JSON', onClick: () => void navigator.clipboard.writeText(rowJson) },
      ];

      // Copy row as INSERT only when we know the target table (editable result).
      if (canEdit && schema && table) {
        const insertCols = columns.map((c) => `"${c}"`).join(', ');
        const insertVals = columns
          .map((c) => {
            const v = row[c];
            if (v === null || v === undefined) return 'NULL';
            return `'${String(v).replace(/'/g, "''")}'`;
          })
          .join(', ');
        const insertSql = `INSERT INTO "${schema}"."${table}" (${insertCols}) VALUES (${insertVals});`;
        items.push({
          label: 'Copy row as INSERT',
          onClick: () => void navigator.clipboard.writeText(insertSql),
        });
      }

      // Quick-add filter shortcuts based on the clicked cell's value.
      if (onAddFilter) {
        const filterCol = baseColumn;
        const isNull = value === null || value === undefined;
        const preview = (() => {
          if (isNull) return 'NULL';
          const s = typeof value === 'string' ? `'${value}'` : String(value);
          return s.length > 24 ? `${s.slice(0, 24)}…` : s;
        })();
        items.push({ type: 'divider' });
        if (isNull) {
          items.push(
            {
              label: `Filter: ${filterCol} IS NULL`,
              onClick: () => onAddFilter({ column: filterCol, operator: 'is_null' }),
            },
            {
              label: `Filter: ${filterCol} IS NOT NULL`,
              onClick: () => onAddFilter({ column: filterCol, operator: 'is_not_null' }),
            },
          );
        } else {
          items.push(
            {
              label: `Filter: ${filterCol} = ${preview}`,
              onClick: () => onAddFilter({ column: filterCol, operator: 'eq', value }),
            },
            {
              label: `Filter: ${filterCol} ≠ ${preview}`,
              onClick: () => onAddFilter({ column: filterCol, operator: 'neq', value }),
            },
            {
              label: `Filter: ${filterCol} IS NULL`,
              onClick: () => onAddFilter({ column: filterCol, operator: 'is_null' }),
            },
          );
        }
      }

      if (editable && !stagedDelete) {
        items.push({ type: 'divider' });
        items.push({
          label: 'Edit cell',
          onClick: () => stores.editing.set({ rowIndex, col }),
        });
        items.push({
          label: 'Set NULL',
          onClick: () => {
            if (!onCellUpdate || !rowPks) return;
            onCellUpdate({ pks: rowPks, column: baseColumn, original: value, next: null });
          },
        });
        if (isCellStaged && schema && table && rowKey) {
          items.push({
            label: 'Revert change',
            onClick: () => unstageEdit({ schema, table, rowKey, column: baseColumn }),
          });
        }
      }

      if (canEdit && rowPks && rowKey) {
        items.push({ type: 'divider' });
        if (stagedDelete && schema && table) {
          items.push({
            label: 'Unstage delete',
            onClick: () => unstageDelete({ schema, table, rowKey }),
          });
        } else if (onRowDelete) {
          items.push({
            label: 'Delete row',
            danger: true,
            onClick: () => onRowDelete({ pks: rowPks, snapshot: row }),
          });
        }
      }

      showMenu(e, items);
    },
    [
      canEdit,
      readOnlyColumnSet,
      onCellUpdate,
      onRowDelete,
      onAddFilter,
      filteredData,
      getRowPks,
      columnToSource,
      tablePending,
      schema,
      table,
      columns,
      stores,
      unstageEdit,
      unstageDelete,
      showMenu,
    ],
  );

  // Header context menu is wired further down where toggleFrozen + handleAutoFit
  // exist; we re-declare the handler with the right captures there.

  // ── Column resize ──────────────────────────────────────────────────────

  // During a drag, the layout store's width is updated on every mousemove.
  // Container re-renders → CSS vars update → cells use unchanged
  // `width: var(--cw-N)` strings, so cells don't re-render either. Fast.
  const [viewer, setViewer] = useState<
    { col: string; columnType?: string; value: any; anchor: DOMRect } | null
  >(null);
  const showValue = useCallback(
    (col: string, columnType: string | undefined, value: any, anchor: DOMRect) =>
      setViewer({ col, columnType, value, anchor }),
    [],
  );

  const [resizingCol, setResizingCol] = useState<string | null>(null);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, col: string) => {
      e.preventDefault();
      e.stopPropagation();
      setResizingCol(col);
      resizeStartXRef.current = e.clientX;
      resizeStartWidthRef.current = resolvedWidths[col];
    },
    [resolvedWidths],
  );
  useEffect(() => {
    if (!resizingCol) return;
    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartXRef.current;
      stores.layout.setWidth(resizingCol, resizeStartWidthRef.current + delta);
    };
    const onUp = () => setResizingCol(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizingCol, stores]);

  // Auto-fit: measure visible cells in the column and shrink-wrap. Fixes the
  // gripe where a column resized too narrow had no way back to a fit width.
  const handleAutoFit = useCallback(
    (col: string) => {
      const root = scrollContainerRef.current;
      if (!root) return;
      const cells = root.querySelectorAll<HTMLElement>(`[data-cell-col="${CSS.escape(col)}"] [data-cell-content]`);
      let max = 80; // sensible floor incl. padding
      cells.forEach((el) => {
        const w = el.scrollWidth + 24; // padding allowance
        if (w > max) max = w;
      });
      const header = root.querySelector<HTMLElement>(`[data-header-col="${CSS.escape(col)}"] [data-header-label]`);
      if (header) {
        const w = header.scrollWidth + 24;
        if (w > max) max = w;
      }
      stores.layout.setWidth(col, Math.min(MAX_COL_WIDTH, max));
    },
    [stores],
  );

  // ── Column reorder ─────────────────────────────────────────────────────

  const dragColRef = useRef<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const handleHeaderDragStart = useCallback((col: string) => {
    dragColRef.current = col;
  }, []);
  const handleHeaderDragOver = useCallback((col: string) => {
    if (dragColRef.current && dragColRef.current !== col) setDragOverCol(col);
  }, []);
  const handleHeaderDrop = useCallback(
    (targetCol: string) => {
      const sourceCol = dragColRef.current;
      dragColRef.current = null;
      setDragOverCol(null);
      if (!sourceCol || sourceCol === targetCol) return;
      const current = layout.order ?? displayColumns;
      const without = current.filter((c) => c !== sourceCol);
      const targetIdx = without.indexOf(targetCol);
      const next = [...without.slice(0, targetIdx), sourceCol, ...without.slice(targetIdx)];
      stores.layout.setOrder(next);
    },
    [layout.order, displayColumns, stores],
  );

  // ── Frozen column ──────────────────────────────────────────────────────
  const toggleFrozen = useCallback(
    (col: string) => {
      stores.layout.setFrozen(layout.frozen === col ? null : col);
    },
    [layout.frozen, stores],
  );

  const onHeaderContext = useCallback(
    (e: React.MouseEvent, col: string) => {
      const isFrozen = layout.frozen === col;
      const hasCustomWidth = col in layout.widths;
      const existingFilter = filters?.find((f) => f.column === col);
      const headerRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const items: ContextMenuEntry[] = [];

      if (onSort) {
        items.push(
          { label: 'Sort ascending', onClick: () => onSort(col) },
          { label: 'Sort descending', onClick: () => onSort(col) },
          { type: 'divider' },
        );
      }
      if (onAddFilter) {
        items.push({
          label: existingFilter ? 'Edit filter…' : 'Filter…',
          onClick: () => setFilterPopover({ column: col, anchor: headerRect }),
        });
        if (existingFilter && onRemoveFilter) {
          items.push({
            label: 'Clear filter',
            onClick: () => onRemoveFilter(col),
          });
        }
        items.push({ type: 'divider' });
      }
      items.push(
        { label: 'Auto-fit width', onClick: () => handleAutoFit(col) },
        {
          label: 'Reset width',
          disabled: !hasCustomWidth,
          onClick: () => stores.layout.resetWidth(col),
        },
        { type: 'divider' },
        {
          label: isFrozen ? 'Unfreeze column' : 'Freeze column',
          onClick: () => toggleFrozen(col),
        },
        { label: 'Copy column name', onClick: () => void navigator.clipboard.writeText(col) },
      );
      showMenu(e, items);
    },
    [
      layout.frozen,
      layout.widths,
      filters,
      onSort,
      onAddFilter,
      onRemoveFilter,
      handleAutoFit,
      toggleFrozen,
      stores,
      showMenu,
    ],
  );

  useImperativeHandle(
    ref,
    () => ({
      clearActiveCell: () => stores.selection.set(null),
      inspectFirstRow: () => {
        if (filteredData.length && displayColumns.length) {
          stores.selection.set({ rowIndex: draftCount, col: displayColumns[0] });
          rowVirtualizer.scrollToIndex(draftCount, { align: 'start' });
        }
      },
      addRecord: () => {
        if (!schema || !table) return;
        stageInsert({ schema, table });
        rowVirtualizer.scrollToIndex(0, { align: 'start' });
      },
    }),
    [schema, table, stageInsert, rowVirtualizer, stores, filteredData.length, displayColumns, draftCount],
  );

  // Right-click on the blank area below the rows. Row and cell handlers own
  // their own targets, so bail when the click landed on one.
  const onCanvasContext = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('[data-index]')) return;
      e.preventDefault();
      const items: ContextMenuEntry[] = [];
      if (canInsert) {
        items.push({
          label: 'Add record',
          onClick: () => {
            if (schema && table) stageInsert({ schema, table });
          },
        });
      }
      if (filteredData.length > 0) {
        if (items.length > 0) items.push({ type: 'divider' });
        if (onBulkExport) {
          items.push({ label: `Export ${filteredData.length} rows`, onClick: () => onBulkExport(filteredData) });
        }
        items.push({
          label: 'Copy rows as JSON',
          onClick: () => void navigator.clipboard.writeText(JSON.stringify(filteredData, null, 2)),
        });
      }
      if (items.length === 0) return;
      showMenu(e, items);
    },
    [canInsert, schema, table, stageInsert, filteredData, onBulkExport, showMenu],
  );

  // Bulk export: snapshot the rows backing the selected row keys.
  const exportSelected = useCallback(() => {
    if (!onBulkExport) return;
    const sel = stores.selectedRows.get();
    const rows: any[] = [];
    for (let i = 0; i < filteredData.length; i++) {
      const r = filteredData[i];
      const rk = rowKeyFromPks(getRowPks(r));
      if (sel.has(rk)) rows.push(r);
    }
    onBulkExport(rows);
  }, [onBulkExport, filteredData, getRowPks, stores]);

  // ── Render ─────────────────────────────────────────────────────────────

  if (isLoading) {
    return <TableSkeleton />;
  }

  const totalWidth = (canEdit ? CHECKBOX_WIDTH : 0) + totalDataWidth;

  const emptyHint =
    data.length > 0
      ? 'no match for the current filter'
      : limit != null
        ? `limit ${limit} offset ${offset ?? 0}`
        : null;

  return (
    <StoresContext.Provider value={stores}>
      <div className={`relative flex flex-col min-h-0${fillParent ? ' flex-1' : ''}`}>
      {isRefreshing && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-40 h-0.5 overflow-hidden" aria-hidden="true">
          <div className="h-full w-1/3 rounded-full bg-accent animate-indeterminate" />
        </div>
      )}
      <div
        ref={scrollContainerRef}
        onContextMenu={onCanvasContext}
        onMouseLeave={() => stores.hovered.set(null)}
        className={`${onInspectRow ? '' : 'border border-border rounded-md '}overflow-auto relative bg-bg${
          fillParent ? ' flex-1 min-h-0' : ''
        }`}
        style={{
          maxHeight: fillParent ? undefined : (maxHeightCss ?? 'calc(100vh - 360px)'),
          minHeight: 240,
          willChange: 'scroll-position',
          // `contain: paint` on the scroll container has been observed to
          // interact poorly with sticky headers in WebKit (the first
          // rows can render hidden behind the header even at scrollTop=0).
          // Row-level containment carries most of the perf win anyway.
          contain: 'layout',
          // Keep scroll-into-view + arrow-nav from landing items behind
          // the sticky header.
          scrollPaddingTop: HEADER_HEIGHT,
          // CSS vars consumed by header cells + body cells.
          ...(widthVars as React.CSSProperties),
        }}
      >
        <div style={{ width: Math.max(totalWidth, 0), minWidth: '100%' }}>
          <HeaderRow
            displayColumns={displayColumns}
            columnTypes={columnTypes}
            canEdit={canEdit}
            allRowKeys={allRowKeys}
            onSelectAll={selectAllVisible}
            onClearSelection={clearSelection}
            frozen={layout.frozen}
            frozenLeft={frozenLeft}
            dragOverCol={dragOverCol}
            onResizeStart={handleResizeStart}
            onAutoFit={handleAutoFit}
            onDragStart={handleHeaderDragStart}
            onDragOver={handleHeaderDragOver}
            onDrop={handleHeaderDrop}
            onHeaderContext={onHeaderContext}
            onSort={onSort}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
          />
          <div
            style={{
              height: rowVirtualizer.getTotalSize(),
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((vr) => {
              const idx = vr.index;
              // Draft rows lead.
              if (idx < draftCount) {
                const ins = stagedInserts[idx];
                if (!ins) return null;
                return (
                  <InsertRow
                    key={vr.key}
                    rowIndex={idx}
                    top={vr.start}
                    displayColumns={displayColumns}
                    columnTypes={columnTypes}
                    columnDefaults={columnDefaults}
                    frozen={layout.frozen}
                    frozenLeft={frozenLeft}
                    selectCell={selectCell}
                    startEdit={startEdit}
                    cancelEdit={cancelEdit}
                    ins={ins}
                    onViewValue={showValue}
                    onSaveStaged={handleStagedInsertSave}
                    onDiscard={handleDiscardInsert}
                  />
                );
              }
              const row = rowAt(idx);
              if (row) {
                return (
                  <Row
                    key={vr.key}
                    rowIndex={idx}
                    top={vr.start}
                    row={row}
                    displayColumns={displayColumns}
                    columnTypes={columnTypes}
                    formatterByColumn={formatterByColumn}
                    canEdit={canEdit}
                    readOnlyColumnSet={readOnlyColumnSet}
                    foreignKeys={foreignKeys}
                    columnToSource={columnToSource}
                    fkClick={fkClick}
                    selectCell={selectCell}
                    startEdit={startEdit}
                    cancelEdit={cancelEdit}
                    onCellSave={handleCellSave}
                    onToggleExpand={toggleRowExpanded}
                    onViewValue={showValue}
                    onToggleSelect={toggleRowSelected}
                    onRowContext={onRowContext}
                    onCellContext={onCellContext}
                    tablePending={tablePending}
                    getRowPks={getRowPks}
                    frozen={layout.frozen}
                    frozenLeft={frozenLeft}
                    measureRef={rowVirtualizer.measureElement}
                  />
                );
              }
              return null;
            })}
          </div>
        </div>
      </div>
      {filteredData.length === 0 && (
        <div
          className="absolute inset-x-0 bottom-0 flex flex-col items-center justify-center gap-1 pointer-events-none select-none"
          style={{ top: HEADER_HEIGHT + (canInsert ? ROW_HEIGHT : 0) }}
        >
          <span className="font-mono text-xs text-secondary">No rows</span>
          {emptyHint && <span className="font-mono text-[11px] text-muted">{emptyHint}</span>}
        </div>
      )}
      {(canEdit || !!onBulkExport) && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none [&>*]:pointer-events-auto">
          <BulkActionBar
            onClear={clearSelection}
            onDelete={canEdit && onRowDelete ? deleteSelected : undefined}
            onExport={onBulkExport ? exportSelected : undefined}
          />
        </div>
      )}
      </div>
      {viewer && (
        <CellValueViewer
          column={viewer.col}
          columnType={viewer.columnType}
          value={viewer.value}
          anchor={viewer.anchor}
          onClose={() => setViewer(null)}
        />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
      {filterPopover && onAddFilter && (
        <ColumnFilterPopover
          column={filterPopover.column}
          columnType={columnTypes[filterPopover.column]}
          initial={filters?.find((f) => f.column === filterPopover.column)}
          anchorRect={filterPopover.anchor}
          onApply={(filter) => {
            onAddFilter(filter);
            setFilterPopover(null);
          }}
          onClear={() => {
            if (onRemoveFilter) onRemoveFilter(filterPopover.column);
            setFilterPopover(null);
          }}
          onClose={() => setFilterPopover(null)}
        />
      )}
    </StoresContext.Provider>
  );
});

QueryResultGrid.displayName = 'QueryResultGrid';

// ─── HeaderRow ───────────────────────────────────────────────────────────

interface HeaderRowProps {
  displayColumns: string[];
  columnTypes: Record<string, string>;
  canEdit: boolean;
  allRowKeys: string[];
  onSelectAll: () => void;
  onClearSelection: () => void;
  frozen: string | null;
  frozenLeft: number;
  dragOverCol: string | null;
  onResizeStart: (e: React.MouseEvent, col: string) => void;
  onAutoFit: (col: string) => void;
  onDragStart: (col: string) => void;
  onDragOver: (col: string) => void;
  onDrop: (col: string) => void;
  onHeaderContext: (e: React.MouseEvent, col: string) => void;
  onSort?: (col: string) => void;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
}

const HeaderRow = memo(function HeaderRow(props: HeaderRowProps) {
  const {
    displayColumns,
    columnTypes,
    canEdit,
    allRowKeys,
    onSelectAll,
    onClearSelection,
    frozen,
    frozenLeft,
    dragOverCol,
    onResizeStart,
    onAutoFit,
    onDragStart,
    onDragOver,
    onDrop,
    onHeaderContext,
    onSort,
    sortColumn,
    sortDirection,
  } = props;
  return (
    <div
      className="bg-bg-secondary sticky top-0 z-30 flex border-b border-border"
      style={{ height: HEADER_HEIGHT }}
    >
      {canEdit && (
        <SelectAllCheckbox
          allRowKeys={allRowKeys}
          onSelectAll={onSelectAll}
          onClear={onClearSelection}
        />
      )}
      {displayColumns.map((col, idx) => (
        <HeaderCell
          key={col}
          col={col}
          idx={idx}
          columnType={columnTypes[col]}
          isFrozen={frozen === col}
          frozenLeft={frozenLeft}
          isDragTarget={dragOverCol === col}
          onResizeStart={onResizeStart}
          onAutoFit={onAutoFit}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onHeaderContext={onHeaderContext}
          onSort={onSort}
          sortState={sortColumn === col ? sortDirection ?? 'asc' : null}
        />
      ))}
    </div>
  );
});

interface HeaderCellProps {
  col: string;
  idx: number;
  columnType?: string;
  isFrozen: boolean;
  frozenLeft: number;
  isDragTarget: boolean;
  onResizeStart: (e: React.MouseEvent, col: string) => void;
  onAutoFit: (col: string) => void;
  onDragStart: (col: string) => void;
  onDragOver: (col: string) => void;
  onDrop: (col: string) => void;
  onHeaderContext: (e: React.MouseEvent, col: string) => void;
  onSort?: (col: string) => void;
  sortState: 'asc' | 'desc' | null;
}

const HeaderCell = memo(function HeaderCell({
  col,
  idx,
  columnType,
  isFrozen,
  frozenLeft,
  isDragTarget,
  onResizeStart,
  onAutoFit,
  onDragStart,
  onDragOver,
  onDrop,
  onHeaderContext,
  onSort,
  sortState,
}: HeaderCellProps) {
  return (
    <div
      data-header-col={col}
      className={`relative group flex-shrink-0 px-3 flex flex-col justify-center border-r border-border text-xs ${
        isFrozen ? 'sticky z-20 bg-bg-secondary' : ''
      } ${isDragTarget ? 'bg-accent/15' : ''} ${
        onSort ? 'cursor-pointer hover:bg-bg-secondary/80' : ''
      }`}
      style={{
        width: `var(--cw-${idx})`,
        ...(isFrozen ? { left: frozenLeft } : {}),
      }}
      title={`${col}${columnType ? ` · ${columnType}` : ''}`}
      draggable
      onClick={onSort ? () => onSort(col) : undefined}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(col);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver(col);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(col);
      }}
      onContextMenu={(e) => onHeaderContext(e, col)}
    >
      <div className="flex items-center gap-1 min-w-0">
        <span data-header-label className="font-semibold text-primary truncate">
          {col}
        </span>
        {sortState && (
          <ChevronUp className="w-3 h-3 text-accent flex-shrink-0" />
        )}
      </div>
      {columnType && (
        <span className="text-[10px] text-muted font-mono truncate">{columnType}</span>
      )}
      <div
        className="absolute top-0 right-0 bottom-0 w-1.5 cursor-col-resize opacity-0 group-hover:opacity-100 hover:bg-accent/40 active:bg-accent"
        // Stop click + mousedown from bubbling so resizing/auto-fitting
        // doesn't also trigger a sort on the header.
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => {
          e.stopPropagation();
          onResizeStart(e, col);
        }}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onAutoFit(col);
        }}
        title="Drag to resize · double-click to auto-fit"
      />
    </div>
  );
});

// ─── Row ─────────────────────────────────────────────────────────────────

interface RowProps {
  rowIndex: number;
  top: number;
  row: any;
  displayColumns: string[];
  columnTypes: Record<string, string>;
  formatterByColumn: Record<string, ColumnFormatter>;
  canEdit: boolean;
  readOnlyColumnSet: Set<string>;
  foreignKeys?: Record<string, ForeignKeyTarget>;
  columnToSource?: Record<string, string>;
  fkClick: (sourceColumn: string, fk: ForeignKeyTarget, value: any) => void;
  selectCell: (rowIndex: number, col: string) => void;
  startEdit: (rowIndex: number, col: string) => void;
  cancelEdit: () => void;
  onCellSave: (rowIndex: number, col: string, original: any, next: any, intent?: SaveIntent) => void;
  onToggleExpand: (rowIndex: number) => void;
  onViewValue: CellProps['onViewValue'];
  onToggleSelect: (rowIndex: number, rowKey: string, shift: boolean) => void;
  onRowContext: (e: React.MouseEvent, rowIndex: number) => void;
  onCellContext: (e: React.MouseEvent, rowIndex: number, col: string, value: any) => void;
  tablePending: TablePending | null;
  getRowPks: (row: any) => Record<string, any>;
  frozen: string | null;
  frozenLeft: number;
  measureRef: (el: Element | null) => void;
}

const Row = memo(function Row(props: RowProps) {
  const {
    rowIndex,
    top,
    row,
    displayColumns,
    columnTypes,
    formatterByColumn,
    canEdit,
    readOnlyColumnSet,
    foreignKeys,
    columnToSource,
    fkClick,
    selectCell,
    startEdit,
    cancelEdit,
    onCellSave,
    onToggleExpand,
    onViewValue,
    onToggleSelect,
    onRowContext,
    onCellContext,
    tablePending,
    getRowPks,
    frozen,
    frozenLeft,
    measureRef,
  } = props;

  const { expanded, selectedRows, selection } = useStores();
  const isExpanded = useIsRowExpanded(expanded, rowIndex);
  const isActive = useIsActiveRow(selection, rowIndex);
  const rowKey = canEdit ? rowKeyFromPks(getRowPks(row)) : null;
  const isSelected = useIsRowSelected(selectedRows, rowKey);
  const isStagedDelete = rowKey && tablePending?.deletes[rowKey] ? true : false;
  const stagedEdit = rowKey && tablePending?.edits[rowKey];

  return (
    <div
      data-index={rowIndex}
      ref={measureRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        transform: `translateY(${top}px)`,
        contain: 'layout paint',
      }}
    >
      <div
        className={`flex border-b border-border ${
          isStagedDelete
            ? 'bg-danger/20 line-through text-secondary'
            : isActive
              ? 'bg-accent/12 border-l-2 border-l-accent'
            : isSelected
              ? 'bg-accent/15'
              : rowIndex % 2 === 1
                ? 'bg-bg-secondary/30'
                : 'bg-bg'
        }`}
        style={{ height: ROW_HEIGHT }}
        onContextMenu={(e) => onRowContext(e, rowIndex)}
      >
        {/* Checkbox column (only when editable) */}
        {canEdit && rowKey && (
          <div
            className="flex-shrink-0 flex items-center justify-center border-r border-border"
            style={{ width: CHECKBOX_WIDTH }}
            onClick={(e) => e.stopPropagation()}
          >
            <Checkbox
              checked={isSelected}
              onClick={(e) => onToggleSelect(rowIndex, rowKey, e.shiftKey)}
              aria-label={`Select row ${rowIndex + 1}`}
            />
          </div>
        )}
        {canEdit && !rowKey && (
          <div className="flex-shrink-0 border-r border-border" style={{ width: CHECKBOX_WIDTH }} />
        )}
        {/* Data cells */}
        {displayColumns.map((col, idx) => {
          const editable = canEdit && !readOnlyColumnSet.has(col);
          const stagedCellChanged = !!(
            stagedEdit && stagedEdit.changes[columnToSource?.[col] ?? col]
          );
          return (
            <Cell
              key={col}
              rowIndex={rowIndex}
              col={col}
              colIdx={idx}
              value={row[col]}
              columnType={columnTypes[col]}
              formatter={formatterByColumn[col]}
              editable={editable}
              stagedCellChanged={stagedCellChanged}
              isFrozen={frozen === col}
              frozenLeft={frozenLeft}
              fk={foreignKeys?.[col]}
              fkClick={fkClick}
              selectCell={selectCell}
              startEdit={startEdit}
              cancelEdit={cancelEdit}
              onCellSave={onCellSave}
              onCellContext={onCellContext}
              onToggleExpand={onToggleExpand}
              onViewValue={onViewValue}
            />
          );
        })}
      </div>
      {isExpanded && (
        <ExpandedDetail row={row} columns={displayColumns} columnTypes={columnTypes} />
      )}
    </div>
  );
});

// ─── ExpandedDetail ──────────────────────────────────────────────────────

const ExpandedDetail = memo(function ExpandedDetail({
  row,
  columns,
  columnTypes,
}: {
  row: any;
  columns: string[];
  columnTypes: Record<string, string>;
}) {
  return (
    <div className="border-b border-border bg-bg-secondary/40 px-4 py-3">
      <div className="text-xs font-medium text-secondary mb-2">Row detail</div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="border-collapse text-sm">
          <thead>
            <tr className="bg-bg-secondary">
              {columns.map((col) => (
                <th
                  key={col}
                  className="text-left px-3 py-1.5 border-b border-r border-border last:border-r-0 whitespace-nowrap"
                >
                  <span className="text-xs font-medium text-secondary">{col}</span>
                  {columnTypes[col] && (
                    <span className="ml-1.5 text-[11px] font-mono text-muted">{columnTypes[col]}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="align-top">
              {columns.map((col) => {
                const value = row[col];
                const isNull = value === null || value === undefined;
                return (
                  <td
                    key={col}
                    className="px-3 py-1.5 border-r border-border last:border-r-0 font-mono text-primary align-top"
                  >
                    {/* Capped and scrolled per cell: otherwise one long value
                        wraps into dozens of lines and every other cell in the
                        row stretches to match it. */}
                    <div className="max-w-[320px] max-h-24 overflow-y-auto whitespace-pre-wrap break-all">
                      {isNull ? (
                        <span className="text-muted">NULL</span>
                      ) : typeof value === 'object' ? (
                        JSON.stringify(value, null, 2)
                      ) : (
                        String(value)
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
});

// ─── Cell ────────────────────────────────────────────────────────────────

interface CellProps {
  rowIndex: number;
  col: string;
  colIdx: number;
  value: any;
  columnType?: string;
  /** Shown when `value` is undefined — a draft cell that will take NULL/DEFAULT. */
  placeholder?: string;
  formatter?: ColumnFormatter;
  editable: boolean;
  stagedCellChanged: boolean;
  isFrozen: boolean;
  frozenLeft: number;
  fk?: ForeignKeyTarget;
  fkClick: (sourceColumn: string, fk: ForeignKeyTarget, value: any) => void;
  selectCell: (rowIndex: number, col: string) => void;
  startEdit: (rowIndex: number, col: string) => void;
  cancelEdit: () => void;
  onCellSave: (rowIndex: number, col: string, original: any, next: any, intent?: SaveIntent) => void;
  onCellContext: (e: React.MouseEvent, rowIndex: number, col: string, value: any) => void;
  onToggleExpand?: (rowIndex: number) => void;
  onViewValue: (col: string, columnType: string | undefined, value: any, anchor: DOMRect) => void;
}


function formatFullValue(value: any): string {
  if (value === null) return 'NULL';
  if (value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  const s = String(value);
  if (/^\s*[{[]/.test(s)) {
    try {
      return JSON.stringify(JSON.parse(s), null, 2);
    } catch {
      return s;
    }
  }
  return s;
}

function CellValueViewer({
  column,
  columnType,
  value,
  anchor,
  onClose,
}: {
  column: string;
  columnType?: string;
  value: any;
  anchor: DOMRect;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const text = formatFullValue(value);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const width = 380;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
  const below = window.innerHeight - anchor.bottom > 240;

  return createPortal(
    <div
      ref={ref}
      style={{
        width,
        left,
        ...(below ? { top: anchor.bottom + 4 } : { bottom: window.innerHeight - anchor.top + 4 }),
      }}
      className="fixed z-50 rounded-md border border-border bg-bg shadow-xl"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <span className="text-xs font-medium text-primary truncate">{column}</span>
        {columnType && <span className="text-[11px] text-muted font-mono">{columnType}</span>}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          }}
          className="text-muted hover:text-primary transition-colors"
          title="Copy value"
          aria-label="Copy value"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-muted hover:text-primary transition-colors"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <pre className="max-h-64 overflow-auto px-3 py-2 text-xs font-mono text-primary whitespace-pre-wrap break-all">
        {text.length === 0 ? <span className="text-muted">(empty)</span> : text}
      </pre>
    </div>,
    document.body,
  );
}

function CellAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className="flex items-center justify-center h-5 w-5 rounded-sm border border-border bg-bg text-muted hover:text-primary hover:border-secondary transition-colors"
    >
      {children}
    </button>
  );
}

const Cell = memo(function Cell(props: CellProps) {
  const {
    rowIndex,
    col,
    colIdx,
    value,
    columnType,
    placeholder,
    formatter,
    editable,
    stagedCellChanged,
    isFrozen,
    frozenLeft,
    fk,
    fkClick,
    selectCell,
    startEdit,
    cancelEdit,
    onCellSave,
    onCellContext,
    onToggleExpand,
    onViewValue,
  } = props;

  const { selection, editing, hovered } = useStores();
  const isSelected = useIsHere(selection, rowIndex, col);
  const isEditing = useIsHere(editing, rowIndex, col);
  const isHovered = useIsHere(hovered, rowIndex, col);

  const handleClick = useCallback(
    (_e: React.MouseEvent) => {
      // Intentionally NOT stopping propagation. The ContextMenu component
      // listens for document-level clicks to dismiss itself, and the row
      // container has no onClick, so letting the event bubble is harmless
      // here and necessary for the menu to close after a right-click.
      //
      // Cells aren't focusable, so a click on one doesn't take focus away
      // from the SQL editor's CodeMirror (a contenteditable). Without this
      // blur, arrow keys keep moving the editor's caret instead of the
      // grid's selection.
      const ae = document.activeElement;
      if (ae instanceof HTMLElement && ae !== document.body) ae.blur();
      selectCell(rowIndex, col);
    },
    [rowIndex, col, selectCell],
  );

  const handleContext = useCallback(
    (e: React.MouseEvent) => {
      // Stop bubbling so the row-level onContextMenu doesn't also fire and
      // overwrite the cell menu with the row menu.
      e.stopPropagation();
      onCellContext(e, rowIndex, col, value);
    },
    [onCellContext, rowIndex, col, value],
  );

  const handleStartEdit = useCallback(() => {
    if (editable) startEdit(rowIndex, col);
  }, [editable, startEdit, rowIndex, col]);

  const handleSave = useCallback(
    (column: string, next: any, intent?: SaveIntent) => {
      onCellSave(rowIndex, column, value, next, intent);
    },
    [onCellSave, rowIndex, value],
  );

  return (
    <div
      data-cell-col={col}
      className={`flex-shrink-0 px-3 flex items-center text-sm text-primary font-mono border-r border-border ${
        isFrozen ? 'sticky z-10 bg-inherit' : ''
      } ${stagedCellChanged ? 'bg-warning/30 border-l-2 border-l-warning' : ''} ${
        isSelected ? 'ring-2 ring-inset ring-accent/60 bg-accent/5' : ''
      }`}
      style={{
        width: `var(--cw-${colIdx})`,
        ...(isFrozen ? { left: frozenLeft } : {}),
      }}
      onClick={handleClick}
      onContextMenu={handleContext}
      onMouseEnter={() => hovered.set({ rowIndex, col })}
    >
      <div data-cell-content className="truncate flex-1 min-w-0">
        {editable ? (
          isEditing ? (
            <EditableCell
              value={value}
              placeholder={placeholder}
              column={col}
              columnType={columnType}
              isEditing
              onStartEdit={handleStartEdit}
              onSave={handleSave}
              onCancel={cancelEdit}
            />
          ) : (
            <CellDisplay
              value={value}
              placeholder={placeholder}
              column={col}
              columnType={columnType}
              onStartEdit={handleStartEdit}
            />
          )
        ) : formatter ? (
          <FormattedCell formatted={applyFormatter(value, formatter.preset)} rawValue={value} />
        ) : (
          <SmartCellDisplay value={value} column={col} columnType={columnType} />
        )}
      </div>
      {isHovered && (
      <div className="flex-shrink-0 flex items-center gap-0.5 ml-1">
        {onToggleExpand && (
          <CellAction label="Expand row" onClick={() => onToggleExpand(rowIndex)}>
            <Maximize2 className="h-3 w-3" />
          </CellAction>
        )}
        <CellAction
          label="Show full value"
          onClick={(e) =>
            onViewValue(
              col,
              columnType,
              value,
              (e.currentTarget.closest('[data-cell-col]') ?? e.currentTarget).getBoundingClientRect(),
            )
          }
        >
          <Eye className="h-3 w-3" />
        </CellAction>
        {editable && (
          <CellAction label="Edit value" onClick={() => startEdit(rowIndex, col)}>
            <PencilLine className="h-3 w-3" />
          </CellAction>
        )}
      </div>
      )}
      {fk && value !== null && value !== undefined && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            fkClick(col, fk, value);
          }}
          className="flex-shrink-0 ml-1 p-0.5 text-blue-400 hover:text-blue-300 rounded-sm"
          title={`Open ${fk.schema}.${fk.table} where ${fk.column} = ${String(value)}`}
          aria-label="Follow foreign key"
        >
          <ArrowUpRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
});

// ─── SelectAllCheckbox ───────────────────────────────────────────────────

interface SelectAllCheckboxProps {
  allRowKeys: string[];
  onSelectAll: () => void;
  onClear: () => void;
}

const SelectAllCheckbox = memo(function SelectAllCheckbox({
  allRowKeys,
  onSelectAll,
  onClear,
}: SelectAllCheckboxProps) {
  const { selectedRows } = useStores();
  const state = useSyncExternalStore(selectedRows.subscribe, () => {
    if (allRowKeys.length === 0) return 'none';
    const sel = selectedRows.get();
    let count = 0;
    for (const k of allRowKeys) if (sel.has(k)) count++;
    return count === 0 ? 'none' : count === allRowKeys.length ? 'all' : 'some';
  });
  return (
    <div
      className="flex-shrink-0 flex items-center justify-center border-r border-border"
      style={{ width: CHECKBOX_WIDTH }}
      onClick={(e) => e.stopPropagation()}
    >
      <Checkbox
        checked={state === 'all' ? true : state === 'some' ? 'indeterminate' : false}
        onChange={() => (state === 'all' ? onClear() : onSelectAll())}
        aria-label="Select all visible rows"
        disabled={allRowKeys.length === 0}
      />
    </div>
  );
});

// ─── InsertRow (staged insert or always-empty placeholder) ───────────────

interface InsertRowProps {
  rowIndex: number;
  top: number;
  displayColumns: string[];
  columnTypes: Record<string, string>;
  columnDefaults: Record<string, 'DEFAULT' | 'NULL'>;
  frozen: string | null;
  frozenLeft: number;
  selectCell: (rowIndex: number, col: string) => void;
  startEdit: (rowIndex: number, col: string) => void;
  cancelEdit: () => void;
  onViewValue: CellProps['onViewValue'];
  ins: { tempId: string; values: Record<string, any> };
  onSaveStaged: (tempId: string, col: string, value: any, intent?: SaveIntent) => void;
  onDiscard: (tempId: string) => void;
}

const InsertRow = memo(function InsertRow(props: InsertRowProps) {
  const {
    rowIndex,
    top,
    displayColumns,
    columnTypes,
    columnDefaults,
    frozen,
    frozenLeft,
    selectCell,
    startEdit,
    cancelEdit,
    ins,
    onViewValue,
    onSaveStaged,
    onDiscard,
  } = props;

  const onCellSave = useCallback(
    (_rowIndex: number, col: string, _original: any, next: any, intent?: SaveIntent) => {
      onSaveStaged(ins.tempId, col, next, intent);
    },
    [ins, onSaveStaged],
  );

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onDiscard(ins.tempId);
    },
    [ins, onDiscard],
  );

  return (
    <div
      data-index={rowIndex}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        transform: `translateY(${top}px)`,
        contain: 'layout paint',
      }}
    >
      <div
        className="flex border-y border-warning/40 bg-warning/10 hover:bg-warning/15"
        style={{ height: ROW_HEIGHT }}
        onContextMenu={onContextMenu}
      >
        <button
          type="button"
          onClick={() => onDiscard(ins.tempId)}
          className="flex-shrink-0 flex items-center justify-center border-r border-border text-muted hover:text-danger transition-colors"
          style={{ width: CHECKBOX_WIDTH }}
          aria-label="Discard this new record"
          title="Discard this new record"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        {displayColumns.map((col, idx) => (
          <Cell
            key={col}
            rowIndex={rowIndex}
            col={col}
            colIdx={idx}
            value={ins.values[col]}
            columnType={columnTypes[col]}
            placeholder={columnDefaults[col] ?? 'NULL'}
            editable={true}
            stagedCellChanged={false}
            isFrozen={frozen === col}
            frozenLeft={frozenLeft}
            fk={undefined}
            fkClick={() => {}}
            selectCell={selectCell}
            startEdit={startEdit}
            cancelEdit={cancelEdit}
            onCellSave={onCellSave}
            onCellContext={() => {}}
            onViewValue={onViewValue}
          />
        ))}
      </div>
    </div>
  );
});

// ─── BulkActionBar ───────────────────────────────────────────────────────

interface BulkActionBarProps {
  onClear: () => void;
  onDelete?: () => void;
  onExport?: () => void;
}

const BulkActionBar = memo(function BulkActionBar({
  onClear,
  onDelete,
  onExport,
}: BulkActionBarProps) {
  const { selectedRows } = useStores();
  const count = useSyncExternalStore(selectedRows.subscribe, () => selectedRows.get().size);
  if (count === 0) return null;
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 bg-bg border border-accent/40 rounded-md shadow-lg text-sm">
      <span className="text-primary">
        <span className="font-semibold">{count}</span> row{count === 1 ? '' : 's'} selected
      </span>
      <div className="flex items-center gap-2">
        {onExport && (
          <button
            onClick={onExport}
            className="px-2 py-1 text-xs font-medium text-primary hover:bg-bg-secondary rounded-sm"
          >
            Export {count} row{count === 1 ? '' : 's'}
          </button>
        )}
        {onDelete && (
          <button
            onClick={onDelete}
            className="px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10 rounded-sm"
          >
            Delete {count} row{count === 1 ? '' : 's'}
          </button>
        )}
        <button
          onClick={onClear}
          className="px-2 py-1 text-xs font-medium text-muted hover:text-primary hover:bg-bg-secondary rounded-sm"
        >
          Clear selection
        </button>
      </div>
    </div>
  );
});

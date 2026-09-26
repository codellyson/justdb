import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  ListFilter,
  MoreHorizontal,
  PanelRight,
  Plus,
  RefreshCw,
  Table,
  Table2,
} from 'lucide-react';
import { Checkbox } from '@codellyson/justui/react';
import {
  MenuItem,
  MenuLabel,
  MenuSeparator,
  SegmentedControl,
  ToolbarButton,
  ToolbarGroup,
  ToolbarMenu,
} from './ui/toolbar';
import type { Filter } from '@/lib/filters';
import { WhereFilterInput } from './where-filter-input';
import { Check, X } from 'lucide-react';

export type TableView = 'data' | 'structure';

const PAGE_SIZES = [50, 100, 250, 500];

interface TableToolbarProps {
  view: TableView;
  onViewChange: (view: TableView) => void;

  columns: string[];
  visibleColumns: string[];
  onToggleColumn: (column: string) => void;
  onShowAllColumns: () => void;
  onHideAllColumns: () => void;

  filters: Filter[];
  onRemoveFilter: (column: string) => void;
  onClearFilters: () => void;
  onApplyFilters: (filters: Filter[]) => void;

  sortColumn: string | null;
  sortDirection: 'asc' | 'desc' | null;
  onSort: (column: string) => void;
  onClearSort: () => void;

  isBusy?: boolean;
  onRefresh: () => void;
  onRefreshSchema: () => void;

  canAddRecord?: boolean;
  onAddRecord: () => void;
  pendingCount?: number;
  onSaveChanges: () => void;
  onDiscardChanges: () => void;
  onImportCsv: () => void;
  onExport: () => void;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  canInspect: boolean;
}

export function TableToolbar({
  view,
  onViewChange,
  columns,
  visibleColumns,
  onToggleColumn,
  onShowAllColumns,
  onHideAllColumns,
  filters,
  onRemoveFilter,
  onClearFilters,
  onApplyFilters,
  sortColumn,
  sortDirection,
  onSort,
  onClearSort,
  isBusy,
  onRefresh,
  onRefreshSchema,
  canAddRecord,
  onAddRecord,
  pendingCount = 0,
  onSaveChanges,
  onDiscardChanges,
  onImportCsv,
  onExport,
  inspectorOpen,
  onToggleInspector,
  canInspect,
}: TableToolbarProps) {
  const hiddenCount = columns.length - visibleColumns.length;
  const notData = view !== 'data';

  return (
    <div className="table-toolbar shrink-0 border-b border-border bg-bg">
      <div className="flex min-h-12 items-center justify-between gap-4 overflow-x-auto px-3 py-2 scrollbar-none">
        <SegmentedControl
          value={view}
          onChange={onViewChange}
          options={[
            { value: 'data', label: 'Data', icon: <Table2 className="h-4 w-4" /> },
            { value: 'structure', label: 'Structure', icon: <Table className="h-4 w-4" /> },
          ]}
        />

        <div className="table-row-actions flex shrink-0 items-center gap-2">
          <ToolbarButton
            icon={<Plus className="h-4 w-4" />}
            disabled={!canAddRecord || notData}
            onClick={onAddRecord}
            tooltip="Add record (Alt+N)"
          >
            <span>Add record</span>
          </ToolbarButton>

          {pendingCount > 0 && view === 'data' && (
            <>
              <ToolbarButton
                onClick={onSaveChanges}
                variant="accent"
                title={`Review and run ${pendingCount} pending ${pendingCount === 1 ? 'change' : 'changes'}`}
              >
                Save changes ({pendingCount})
              </ToolbarButton>
              <ToolbarButton
                onClick={onDiscardChanges}
                className="underline underline-offset-2 hover:text-danger"
                title="Discard all pending changes"
              >
                Discard changes
              </ToolbarButton>
            </>
          )}

          <ToolbarButton
            icon={<PanelRight className="h-4 w-4" />}
            onClick={onToggleInspector}
            disabled={notData || !canInspect}
            aria-pressed={inspectorOpen}
            tooltip="Toggle row details"
            className={inspectorOpen ? 'bg-accent/10 text-accent' : ''}
          >
            Row details
          </ToolbarButton>

          <ToolbarGroup className="ml-1 border-l border-border pl-2">
            <ToolbarButton
              icon={<RefreshCw className={`h-4 w-4 ${isBusy ? 'animate-spin' : ''}`} />}
              aria-label="Refresh rows"
              tooltip="Refresh rows (Alt+R)"
              onClick={onRefresh}
            />
            <ToolbarMenu
              icon={<MoreHorizontal className="h-4 w-4" />}
              align="right"
              title="More actions"
              width={200}
            >
              <>
                <MenuItem onClick={onRefreshSchema}>Refresh schema</MenuItem>
                <MenuItem onClick={onImportCsv}>Import CSV</MenuItem>
                <MenuItem onClick={onExport}>Export</MenuItem>
              </>
            </ToolbarMenu>
          </ToolbarGroup>
        </div>
      </div>
      <div className="table-filter-tools flex min-h-12 items-center gap-3 border-t border-border/60 px-3 py-2">
        <ToolbarGroup>
          <ToolbarMenu
            label="Filters"
            icon={<ListFilter className="h-4 w-4" />}
            badge={filters.length}
            disabled={notData}
            width={280}
          >
            <>
              {filters.length === 0 ? (
                <div className="px-2 py-2 text-xs text-muted">
                  No filters. Add one from a column header menu.
                </div>
              ) : (
                <>
                  {filters.map((f) => (
                    <MenuItem key={f.column} onClick={() => onRemoveFilter(f.column)}>
                      <span className="flex-1 truncate">
                        <span className="text-primary">{f.column}</span>{' '}
                        <span className="text-muted">
                          {f.operator} {String(f.value ?? '')}
                        </span>
                      </span>
                      <X className="h-3.5 w-3.5 text-muted" />
                    </MenuItem>
                  ))}
                  <MenuSeparator />
                  <MenuItem onClick={onClearFilters} danger>
                    Clear all filters
                  </MenuItem>
                </>
              )}
            </>
          </ToolbarMenu>

          <ToolbarMenu
            label="Sort"
            icon={<ArrowUpDown className="h-4 w-4" />}
            active={!!sortColumn}
            disabled={notData || columns.length === 0}
            width={240}
          >
            <>
              <MenuLabel>Sort by</MenuLabel>
              {columns.map((col) => (
                <MenuItem key={col} onClick={() => onSort(col)}>
                  <span className="flex-1 truncate">{col}</span>
                  {sortColumn === col && (
                    <span className="text-accent">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </MenuItem>
              ))}
              {sortColumn && (
                <>
                  <MenuSeparator />
                  <MenuItem onClick={onClearSort}>Clear sort</MenuItem>
                </>
              )}
            </>
          </ToolbarMenu>

          <ToolbarMenu
            label="Columns"
            icon={<Columns3 className="h-4 w-4" />}
            badge={hiddenCount > 0 ? hiddenCount : undefined}
            disabled={notData || columns.length === 0}
            width={240}
          >
            <>
              <div className="flex gap-1 px-1 pb-1">
                <button
                  type="button"
                  onClick={onShowAllColumns}
                  className="flex-1 px-2 py-1 text-xs rounded-sm text-secondary hover:text-primary hover:bg-bg-secondary"
                >
                  Show all
                </button>
                <button
                  type="button"
                  onClick={onHideAllColumns}
                  className="flex-1 px-2 py-1 text-xs rounded-sm text-secondary hover:text-primary hover:bg-bg-secondary"
                >
                  Hide all
                </button>
              </div>
              <MenuSeparator />
              {columns.map((col) => (
                <MenuItem
                  key={col}
                  onClick={() => onToggleColumn(col)}
                  onSelect={(e) => e.preventDefault()}
                >
                  <Checkbox checked={visibleColumns.includes(col)} className="pointer-events-none" />
                  <span className="flex-1 truncate">{col}</span>
                </MenuItem>
              ))}
            </>
          </ToolbarMenu>
        </ToolbarGroup>

        <WhereFilterInput filters={filters} columns={columns} onApply={onApplyFilters} disabled={notData || columns.length === 0} />

      </div>
    </div>
  );
}

interface TableStatusBarProps {
  currentPage: number;
  itemsPerPage: number;
  totalItems: number;
  countIsEstimate?: boolean;
  onPageChange: (page: number) => void;
  onItemsPerPageChange: (size: number) => void;

  durationMs?: number | null;
  isBusy?: boolean;
  table: string;
  selectedRow?: number;
}

export function TableStatusBar({ currentPage, itemsPerPage, totalItems, countIsEstimate, onPageChange, onItemsPerPageChange, durationMs, isBusy, table, selectedRow }: TableStatusBarProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const first = totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  const last = Math.min(currentPage * itemsPerPage, totalItems);
  const total = countIsEstimate ? `~${totalItems.toLocaleString()}` : totalItems.toLocaleString();
  return (
    <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-3 border-t border-border px-3 py-1 text-xs text-muted">
      <span className="max-w-44 truncate font-mono text-secondary" title={table}>{table}</span>
      <span className="tabular-nums">{total} rows</span>
      {selectedRow != null && <span className="text-accent">Row {selectedRow} selected</span>}
      <div className="flex-1" />
          <span className="w-14 text-right text-xs text-muted tabular-nums shrink-0">
            {durationMs == null
              ? ''
              : durationMs < 1000
                ? `${Math.round(durationMs)}ms`
                : `${(durationMs / 1000).toFixed(1)}s`}
          </span>

          <ToolbarGroup bordered>
            <ToolbarButton
              icon={<ChevronLeft className="h-4 w-4" />}
              aria-label="Previous page"
              tooltip="Previous page"
              disabled={currentPage <= 1 || isBusy}
              onClick={() => onPageChange(currentPage - 1)}
              className="h-7 px-1.5 border-0"
            />
            <ToolbarMenu
              label={
                <span className="tabular-nums text-xs text-secondary">
                  {first}–{last} of {total}
                </span>
              }
              align="right"
              width={160}
              triggerClassName="h-7 px-2 border-0"
            >
              <>
                <MenuLabel>Rows per page</MenuLabel>
                {PAGE_SIZES.map((size) => (
                  <MenuItem key={size} onClick={() => onItemsPerPageChange(size)}>
                    <span className="flex-1">{size}</span>
                    {size === itemsPerPage && <Check className="h-3.5 w-3.5 text-accent" />}
                  </MenuItem>
                ))}
              </>
            </ToolbarMenu>
            <ToolbarButton
              icon={<ChevronRight className="h-4 w-4" />}
              aria-label="Next page"
              tooltip="Next page"
              disabled={currentPage >= totalPages || isBusy}
              onClick={() => onPageChange(currentPage + 1)}
              className="h-7 px-1.5 border-0"
            />
          </ToolbarGroup>
    </div>
  );
}


import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { Header } from "./header";
import { Sidebar } from "./sidebar";
import { MainContent } from "./main-content";
import {
  QueryResultGrid,
  type QueryResultGridHandle,
  type ForeignKeyTarget as QrgForeignKeyTarget,
} from "./query-result-grid";
import { TableSchema } from "./table-schema";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { ResizableSplitter } from "./resizable-splitter";
import { MobileMenu } from "./mobile-menu";
import { TableList } from "./table-list";
import { ExportModal } from "./export-modal";
import { Breadcrumb } from "./breadcrumb";
import { RelationshipDisplay } from "./relationship-display";
import { PendingChangesBar } from "./pending-changes-bar";
import { ReviewSqlModal } from "./review-sql-modal";
import { TablePicker } from "./table-picker";
import { CommandPalette, type CommandAction } from "./command-palette";
import { FKSidePanel, type FKQuery } from "./fk-side-panel";
type ForeignKeyTarget = QrgForeignKeyTarget;
import { KeyboardShortcutsHelp } from "./keyboard-shortcuts-help";
import { TableStats } from "./table-stats";
import { CSVImportDialog } from "./csv-import-dialog";
import { TableCreationWizard } from "./table-creation-wizard";
import { BatchExportModal } from "./batch-export-modal";
import { TabBar } from "./tab-bar";
import { QueryEditor } from "./query-editor";
import { RowInspector } from "./row-inspector";
import { TableToolbar, TableStatusBar, type TableView } from "./table-toolbar";
import { AiChatPanel } from "./ai-chat-panel";
import { Button } from "./ui/button";
import { useConnection } from "../contexts/connection-context";
import { useDashboard } from "../contexts/dashboard-context";
import { usePendingChanges } from "../contexts/pending-changes-context";
import { useTheme } from "../contexts/theme-context";
import { useKeyboardShortcuts, type Shortcut } from "../hooks/use-keyboard-shortcuts";
import { useTableListPrefs } from "../hooks/use-table-list-prefs";
import { useUrlState } from "../hooks/use-url-state";
import { usePlugins } from "../hooks/use-plugins";
import { Plus, Sparkles } from 'lucide-react';

export function Dashboard() {
  const { isConnected, databaseName, databaseType } = useConnection();
  const {
    tables,
    schemas,
    selectedSchema,
    selectedTable,
    tableData,
    columns,
    schema,
    views,
    materializedViews,
    dbFunctions,
    relationships,
    indexes,
    isLoadingTables,
    isLoading,
    isRefreshing,
    isLoadingSchema,
    currentPage,
    totalItems,
    countIsEstimate,
    queryDurationMs,
    sortColumn,
    sortDirection,
    visibleColumns,
    tableSearch,
    tableFilters,
    setTableFilters,
    addTableFilter,
    removeTableFilter,
    clearTableFilters,
    error,
    itemsPerPage,
    setSelectedTable,
    setCurrentPage,
    setSortColumn,
    setSortDirection,
    loadTableSchema,
    setVisibleColumns,
    loadTables,
    loadTableData,
    handleSchemaChange,
    handleTableSelect,
    handleSort,
    primaryKeys,
    refreshTableData,
    tableStats,
    isLoadingStats,
    setItemsPerPage,
    openTabs,
    activeTabId,
    closeTab,
    setActiveTab,
    closeAllTabs,
    closeOtherTabs,
    reorderTabs,
    toggleTabPin,
    isQueryTab,
    queryTabResults,
    openEditorTab,
    isEditorTab,
    schemaMap,
    tableRowCounts,
    savedQueries,
    deleteSavedQuery,
  } = useDashboard();

  const pending = usePendingChanges();
  const { toggleMode } = useTheme();
  const tableListPrefs = useTableListPrefs(databaseName);
  useUrlState();
  const { allFormatters } = usePlugins();
  const sidebarRef = useRef<HTMLDivElement>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const dataTableRef = useRef<QueryResultGridHandle>(null);

  const columnTypes = useMemo(() => {
    const types: Record<string, string> = {};
    for (const col of schema) {
      types[col.name] = col.type;
    }
    return types;
  }, [schema]);

  // Per-column FK target lookup for the active table. Used by DataTable to
  // render header indicators and cell-level navigation chevrons.
  const foreignKeys = useMemo(() => {
    const map: Record<string, ForeignKeyTarget> = {};
    for (const r of relationships) {
      if (r.source_column && r.target_table) {
        map[r.source_column] = {
          schema: r.target_schema || selectedSchema,
          table: r.target_table,
          column: r.target_column,
        };
      }
    }
    return map;
  }, [relationships, selectedSchema]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isShortcutsHelpOpen, setIsShortcutsHelpOpen] = useState(false);
  const [isCSVImportOpen, setIsCSVImportOpen] = useState(false);
  const [isCreateTableOpen, setIsCreateTableOpen] = useState(false);
  const [isBatchExportOpen, setIsBatchExportOpen] = useState(false);
  const [tableView, setTableView] = useState<TableView>('data');
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [isTablePickerOpen, setIsTablePickerOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isAiOpen, setIsAiOpen] = useState(false);
  // Table sidebar dock: collapsible (reclaims full width) and still resizable.
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    try { return localStorage.getItem('justdb:sidebar-open') !== '0'; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem('justdb:sidebar-open', isSidebarOpen ? '1' : '0'); } catch { /* ignore */ }
  }, [isSidebarOpen]);
  const [fkQuery, setFkQuery] = useState<FKQuery | null>(null);
  const [inspectedRow, setInspectedRow] = useState<{ row: Record<string, any>; index: number } | null>(null);
  const handleInspectRow = useCallback((selection: { row: Record<string, any>; index: number } | null) => {
    setInspectedRow(selection);
  }, []);
  useEffect(() => { setInspectedRow(null); }, [selectedSchema, selectedTable, currentPage, activeTabId, tableView]);
  const [editorEditableTarget, setEditorEditableTarget] = useState<{ schema: string; table: string } | null>(null);

  const reviewTarget: { schema: string; table: string } | null = selectedTable
    ? { schema: selectedSchema, table: selectedTable }
    : editorEditableTarget;
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [bulkExportRows, setBulkExportRows] = useState<any[] | null>(null);

  const onTableSelect = (table: string) => {
    tableListPrefs.recordOpen(table);
    handleTableSelect(table);
    setIsMobileMenuOpen(false);
  };


  const shortcuts: Shortcut[] = useMemo(() => [
    {
      key: 'j', alt: true, description: 'Toggle sidebar',
      category: 'Navigation',
      action: () => setIsMobileMenuOpen((prev) => !prev),
    },
    {
      key: '/', meta: true, description: 'Show keyboard shortcuts',
      category: 'General',
      action: () => setIsShortcutsHelpOpen((prev) => !prev),
    },
    {
      key: 'q', alt: true, description: 'New SQL editor tab',
      category: 'Navigation',
      action: () => openEditorTab(),
    },
    {
      key: 'n', alt: true, description: 'Add new row',
      category: 'Editing',
      action: () => {
        if (primaryKeys.length > 0 && selectedTable) {
          dataTableRef.current?.addRecord();
        }
      },
    },
    {
      key: 'r', alt: true, description: 'Refresh table data',
      category: 'Navigation',
      action: () => {
        if (selectedTable) refreshTableData();
      },
    },
    {
      key: '1', alt: true, description: 'Focus sidebar',
      category: 'Navigation',
      action: () => {
        const firstInput = sidebarRef.current?.querySelector<HTMLElement>('input, button');
        firstInput?.focus();
      },
    },
    {
      key: '2', alt: true, description: 'Focus main content',
      category: 'Navigation',
      action: () => {
        const firstFocusable = mainContentRef.current?.querySelector<HTMLElement>(
          'input, button, [tabindex]:not([tabindex="-1"])'
        );
        firstFocusable?.focus();
      },
    },
    {
      key: 'Escape', description: 'Close modal / cancel',
      category: 'General',
      action: () => {
        if (isCommandPaletteOpen) setIsCommandPaletteOpen(false);
        else if (isTablePickerOpen) setIsTablePickerOpen(false);
        else if (fkQuery) setFkQuery(null);
        else if (isReviewOpen) setIsReviewOpen(false);
        else if (isShortcutsHelpOpen) setIsShortcutsHelpOpen(false);
      },
    },
    {
      key: 's', meta: true, description: 'Save pending changes (Review SQL)',
      category: 'Editing',
      action: () => {
        if (reviewTarget && pending.getCount(reviewTarget.schema, reviewTarget.table) > 0) {
          setIsReviewOpen(true);
        }
      },
    },
    {
      key: 'z', meta: true, description: 'Undo last staged edit',
      category: 'Editing',
      action: () => pending.undo(),
    },
    {
      key: 'z', meta: true, shift: true, description: 'Redo staged edit',
      category: 'Editing',
      action: () => pending.redo(),
    },
    {
      key: 't', meta: true, description: 'New SQL editor',
      category: 'Navigation',
      action: () => openEditorTab(),
    },
    {
      key: 'w', meta: true, description: 'Close active tab',
      category: 'Navigation',
      action: () => {
        if (activeTabId) closeTab(activeTabId);
      },
    },
    {
      key: 'p', meta: true, description: 'Jump to table',
      category: 'Navigation',
      action: () => setIsTablePickerOpen((prev) => !prev),
    },
    {
      key: 'k', meta: true, description: 'Command palette',
      category: 'General',
      action: () => setIsCommandPaletteOpen((prev) => !prev),
    },
    {
      key: 'i', meta: true, description: 'Toggle AI mode',
      category: 'AI',
      action: () => setIsAiOpen((prev) => !prev),
    },
    {
      // Bare `?` (Shift + /) — companion to Cmd+/; hidden to avoid a dup row.
      key: '?', shift: true, description: 'Show keyboard shortcuts',
      category: 'General', hidden: true,
      action: () => setIsShortcutsHelpOpen((prev) => !prev),
    },
  ], [primaryKeys, selectedTable, selectedSchema, isShortcutsHelpOpen, isReviewOpen, openEditorTab, pending, activeTabId, closeTab, isEditorTab, isQueryTab, isTablePickerOpen, isCommandPaletteOpen, fkQuery, refreshTableData]);

  useKeyboardShortcuts(shortcuts);

  const pendingCountForActiveTable = reviewTarget
    ? pending.getCount(reviewTarget.schema, reviewTarget.table)
    : 0;

  const paletteActions: CommandAction[] = useMemo(() => [
    {
      id: 'new-editor',
      label: 'New SQL editor',
      category: 'Editor',
      shortcut: '⌘T',
      run: () => openEditorTab(),
    },
    {
      id: 'toggle-ai',
      label: 'Toggle AI mode',
      category: 'AI',
      shortcut: '⌘I',
      run: () => setIsAiOpen((prev) => !prev),
    },
    {
      id: 'jump-to-table',
      label: 'Jump to table…',
      category: 'Navigate',
      shortcut: '⌘P',
      run: () => setIsTablePickerOpen(true),
    },
    {
      id: 'save-pending',
      label: 'Save pending changes',
      category: 'Edit',
      shortcut: '⌘S',
      enabled: pendingCountForActiveTable > 0,
      run: () => setIsReviewOpen(true),
    },
    {
      id: 'discard-pending',
      label: 'Discard pending changes',
      category: 'Edit',
      enabled: pendingCountForActiveTable > 0,
      run: () => {
        if (reviewTarget) pending.discardTable({ schema: reviewTarget.schema, table: reviewTarget.table });
      },
    },
    {
      id: 'refresh-table',
      label: 'Refresh table data',
      category: 'Edit',
      enabled: !!selectedTable,
      run: () => refreshTableData(),
    },
    {
      id: 'close-tab',
      label: 'Close active tab',
      category: 'Navigate',
      shortcut: '⌘W',
      enabled: !!activeTabId,
      run: () => {
        if (activeTabId) closeTab(activeTabId);
      },
    },
    {
      id: 'toggle-theme',
      label: 'Toggle theme (light/dark)',
      category: 'View',
      run: () => toggleMode(),
    },
    {
      id: 'show-shortcuts',
      label: 'Show keyboard shortcuts',
      category: 'Help',
      shortcut: '?',
      run: () => setIsShortcutsHelpOpen(true),
    },
  ], [
    pendingCountForActiveTable,
    selectedTable,
    selectedSchema,
    pending,
    activeTabId,
    closeTab,
    openEditorTab,
    refreshTableData,
    toggleMode,
  ]);

  const handleCellUpdate = ({
    pks,
    column,
    original,
    next,
  }: {
    pks: Record<string, any>;
    column: string;
    original: any;
    next: any;
  }) => {
    if (!selectedTable) return;
    pending.stageEdit({
      schema: selectedSchema,
      table: selectedTable,
      pks,
      column,
      original,
      next,
    });
  };

  const handleRowDelete = ({
    pks,
    snapshot,
  }: {
    pks: Record<string, any>;
    snapshot: Record<string, any>;
  }) => {
    if (!selectedTable) return;
    pending.stageDelete({
      schema: selectedSchema,
      table: selectedTable,
      pks,
      snapshot,
    });
  };

  if (!isConnected) {
    // Synchronous redirect so the user never sees a `null` frame while
    // Home is in the middle of swapping us out for the Connections
    // landing. (Home itself picks the right view based on session.)
    return <Navigate to="/" replace />;
  }

  return (
    <>
    <MobileMenu isOpen={isMobileMenuOpen} onClose={() => setIsMobileMenuOpen(false)}>
      <div className="mb-4">
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            openEditorTab();
            setIsMobileMenuOpen(false);
          }}
          className="w-full"
        >
          + New SQL editor
        </Button>
      </div>
      <TableList
        tables={tables}
        selectedTable={selectedTable}
        onSelect={onTableSelect}
      />
    </MobileMenu>
    <div className="flex h-screen w-full overflow-hidden">
    <div className="flex-1 min-w-0">
    <ResizableSplitter
      collapsed={!isSidebarOpen}
      storageKey={`dbview-sidebar-width-${databaseName ?? 'default'}`}
      left={
        <div ref={sidebarRef}>
        <Sidebar
          tables={tables}
          selectedTable={selectedTable}
          onTableSelect={onTableSelect}
          isLoading={isLoadingTables}
          databaseName={databaseName}
          schemas={schemas}
          selectedSchema={selectedSchema}
          onSchemaChange={handleSchemaChange}
          views={views}
          materializedViews={materializedViews}
          functions={dbFunctions}
          onCreateTable={() => setIsCreateTableOpen(true)}
          onBatchExport={() => setIsBatchExportOpen(true)}
          pinnedTables={tableListPrefs.pinned}
          recentTables={tableListPrefs.recent}
          onTogglePin={tableListPrefs.togglePin}
          groupByPrefix={tableListPrefs.groupByPrefix}
          onToggleGroupByPrefix={() => tableListPrefs.setGroupByPrefix(!tableListPrefs.groupByPrefix)}
          rowCounts={tableRowCounts}
          savedQueries={savedQueries}
          onOpenSavedQuery={(q) => openEditorTab(q.query)}
          onDeleteSavedQuery={deleteSavedQuery}
        />
        </div>
      }
      right={
        <div ref={mainContentRef} className="flex-1 flex flex-col overflow-hidden">
          <Header
            isConnected={isConnected}
            databaseName={databaseName}
            tableCount={tables.length}
            onMenuToggle={() => setIsMobileMenuOpen(true)}
            onShortcutsHelp={() => setIsShortcutsHelpOpen(true)}
            onOpenSettings={() => window.dispatchEvent(new CustomEvent('justdb:open-settings'))}
            sidebarOpen={isSidebarOpen}
            onToggleSidebar={() => setIsSidebarOpen((v) => !v)}
          />
          <TabBar
            tabs={openTabs}
            activeTabId={activeTabId}
            onTabSelect={setActiveTab}
            onTabClose={closeTab}
            onTabCloseOthers={closeOtherTabs}
            onTabCloseAll={closeAllTabs}
            onTabReorder={reorderTabs}
            onTabTogglePin={toggleTabPin}
            actions={
              <>
                <button
                  onClick={() => openEditorTab()}
                  className="flex h-7 items-center justify-center px-1.5 text-muted hover:text-accent hover:bg-accent/10 rounded-sm transition-colors"
                  title="New SQL editor (Alt+Q)"
                  aria-label="New SQL editor tab"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setIsAiOpen((v) => !v)}
                  className={`flex h-7 items-center gap-1 px-1.5 rounded-sm text-xs font-medium transition-colors ${
                    isAiOpen ? 'text-accent bg-accent/15' : 'text-muted hover:text-accent hover:bg-accent/10'
                  }`}
                  title="Toggle AI mode"
                  aria-label="Toggle AI mode"
                  aria-pressed={isAiOpen}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  AI
                </button>
              </>
            }
          />
          <MainContent compact={!!selectedTable && !isEditorTab && !isQueryTab}>
            {error && (
              <ErrorState
                message={error}
                onRetry={selectedTable ? () => loadTableData(selectedTable, currentPage) : loadTables}
                className="mb-8"
              />
            )}
            {(() => {
              const editorTabs = openTabs.filter((t) => t.type === 'editor');
              if (editorTabs.length === 0) return null;
              return (
                <div className={isEditorTab ? 'flex-1 flex flex-col min-h-0' : 'hidden'}>
                  {isEditorTab && (
                    <Breadcrumb
                      items={[
                        { label: databaseName || 'DATABASE' },
                        { label: openTabs.find((t) => t.id === activeTabId)?.label || 'SQL' },
                      ]}
                    />
                  )}
                  {editorTabs.map((tab) => (
                    <div
                      key={tab.id}
                      className={tab.id === activeTabId ? 'flex-1 flex flex-col min-h-0' : 'hidden'}
                    >
                      <QueryEditor
                        tabId={tab.id}
                        isActive={tab.id === activeTabId}
                        onForeignKeyClick={(args) =>
                          setFkQuery({
                            sourceColumn: args.sourceColumn,
                            fk: args.fk,
                            value: args.value,
                          })
                        }
                        onEditableTargetChange={setEditorEditableTarget}
                      />
                    </div>
                  ))}
                </div>
              );
            })()}
            {isEditorTab ? null : isQueryTab && activeTabId && queryTabResults[activeTabId] ? (
              (() => {
                const qr = queryTabResults[activeTabId];
                return (
                  <>
                    <Breadcrumb
                      items={[
                        { label: databaseName || 'Database', onClick: () => setSelectedTable(undefined) },
                        { label: 'Query Result' },
                      ]}
                    />
                    <div className="flex items-center justify-between mb-4">
                      <h1 className="text-lg sm:text-2xl font-semibold tracking-tight text-primary truncate min-w-0">
                        Query Result
                      </h1>
                      <span className="text-sm text-muted font-mono flex-shrink-0">
                        {qr.rows.length} {qr.rows.length === 1 ? 'row' : 'rows'} · {qr.executionTime}ms
                      </span>
                    </div>
                    <QueryResultGrid
                      columns={qr.columns}
                      data={qr.rows}
                      isLoading={false}
                    />
                  </>
                );
              })()
            ) : selectedTable ? (
              <>
              <div className="flex-1 flex flex-col min-h-0">
                <TableToolbar
                  key={`${selectedSchema}.${selectedTable}`}
                  view={tableView}
                  onViewChange={setTableView}
                  columns={columns}
                  visibleColumns={visibleColumns}
                  onToggleColumn={(col) =>
                    setVisibleColumns((prev) =>
                      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
                    )
                  }
                  onShowAllColumns={() => setVisibleColumns(columns)}
                  onHideAllColumns={() => setVisibleColumns([])}
                  filters={tableFilters}
                  onRemoveFilter={removeTableFilter}
                  onClearFilters={clearTableFilters}
                  onApplyFilters={(filters) => {
                    setTableFilters(filters);
                    setCurrentPage(1);
                  }}
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                  onClearSort={() => {
                    setSortColumn(null);
                    setSortDirection(null);
                  }}
                  inspectorOpen={!!inspectedRow}
                  canInspect={tableData.length > 0}
                  onToggleInspector={() => {
                    if (inspectedRow) dataTableRef.current?.clearActiveCell();
                    else dataTableRef.current?.inspectFirstRow();
                  }}
                  isBusy={isLoading || isRefreshing}
                  onRefresh={() => refreshTableData()}
                  onRefreshSchema={() => selectedTable && loadTableSchema(selectedTable)}
                  canAddRecord={schema.length > 0}
                  onAddRecord={() => dataTableRef.current?.addRecord()}
                  pendingCount={
                    selectedTable ? pending.getCount(selectedSchema, selectedTable) : 0
                  }
                  onSaveChanges={() => setIsReviewOpen(true)}
                  onDiscardChanges={() =>
                    selectedTable &&
                    pending.discardTable({ schema: selectedSchema, table: selectedTable })
                  }
                  onImportCsv={() => setIsCSVImportOpen(true)}
                  onExport={() => setIsExportOpen(true)}
                />
                {tableView === 'data' ? (
                  <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
                    <div className="flex flex-1 min-h-0 min-w-0 flex-col">
                      <QueryResultGrid
                        ref={dataTableRef}
                        fillParent
                        columns={columns}
                        data={tableData}
                        isLoading={isLoading}
                        isRefreshing={isRefreshing}
                        limit={itemsPerPage}
                        offset={(currentPage - 1) * itemsPerPage}
                        onSort={handleSort}
                        sortColumn={sortColumn || undefined}
                        sortDirection={sortDirection ?? undefined}
                        visibleColumns={visibleColumns.length > 0 ? visibleColumns : undefined}
                        searchQuery={tableSearch}
                        primaryKeys={primaryKeys}
                        columnSchema={schema}
                        schema={selectedSchema}
                        table={selectedTable}
                        layoutKey={`${databaseName ?? 'default'}.${selectedSchema}.${selectedTable}`}
                        onCellUpdate={handleCellUpdate}
                        onRowDelete={handleRowDelete}
                        foreignKeys={foreignKeys}
                        onForeignKeyClick={(args) =>
                          setFkQuery({
                            sourceColumn: args.sourceColumn,
                            fk: args.fk,
                            value: args.value,
                          })
                        }
                        filters={tableFilters}
                        onAddFilter={addTableFilter}
                        onRemoveFilter={removeTableFilter}
                        onBulkExport={(rows) => {
                          setBulkExportRows(rows);
                          setIsExportOpen(true);
                        }}
                        columnTypes={columnTypes}
                        activeFormatters={allFormatters}
                        onInspectRow={handleInspectRow}
                      />
                    </div>
                    {inspectedRow && !fkQuery && !isAiOpen && (
                      <RowInspector
                        row={inspectedRow.row}
                        index={inspectedRow.index}
                        offset={(currentPage - 1) * itemsPerPage}
                        columns={columns}
                        columnTypes={columnTypes}
                        foreignKeys={foreignKeys}
                        onForeignKeyClick={(args) => setFkQuery(args)}
                        onClose={() => {
                          dataTableRef.current?.clearActiveCell();
                          setInspectedRow(null);
                        }}
                      />
                    )}
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-auto space-y-4 p-4">
                    {!isLoadingSchema && schema.length > 0 && <TableSchema columns={schema} />}
                    <RelationshipDisplay
                      relationships={relationships}
                      indexes={indexes}
                      onNavigateToTable={onTableSelect}
                    />
                    <TableStats stats={tableStats} isLoading={isLoadingStats} />
                  </div>
                )}
                {tableView === 'data' && (
                  <TableStatusBar
                    table={selectedTable}
                    selectedRow={inspectedRow ? (currentPage - 1) * itemsPerPage + inspectedRow.index + 1 : undefined}
                    currentPage={currentPage}
                    itemsPerPage={itemsPerPage}
                    totalItems={totalItems}
                    countIsEstimate={countIsEstimate}
                    onPageChange={setCurrentPage}
                    onItemsPerPageChange={(size) => {
                      setItemsPerPage(size);
                      setCurrentPage(1);
                    }}
                    durationMs={queryDurationMs}
                    isBusy={isLoading || isRefreshing}
                  />
                )}
              </div>
              </>
            ) : (
              <EmptyState
                title="What do you want to explore?"
                description="Pick a table from the sidebar, or open a SQL editor to run a query."
                action={
                  <Button variant="primary" size="sm" onClick={() => openEditorTab()}>
                    New SQL editor
                  </Button>
                }
              />
            )}
          </MainContent>
        </div>
      }
    />
    </div>
    {/* Docked side panels — they share the layout width rather than overlaying. */}
    <FKSidePanel
      query={fkQuery}
      onClose={() => setFkQuery(null)}
      onOpenTable={(s, t) => {
        if (s !== selectedSchema) handleSchemaChange(s);
        handleTableSelect(t);
        setFkQuery(null);
      }}
      onFollow={(next) => setFkQuery(next)}
    />
    {isAiOpen && <AiChatPanel onClose={() => setIsAiOpen(false)} />}
    </div>
    <PendingChangesBar
      onOpenReview={() => setIsReviewOpen(true)}
      target={selectedTable ? null : editorEditableTarget}
    />
    <CommandPalette
      isOpen={isCommandPaletteOpen}
      onClose={() => setIsCommandPaletteOpen(false)}
      actions={paletteActions}
    />
    {selectedTable && (
      <ExportModal
        isOpen={isExportOpen}
        onClose={() => {
          setIsExportOpen(false);
          setBulkExportRows(null);
        }}
        source={{
          kind: 'table',
          schema: selectedSchema,
          table: selectedTable,
          databaseType,
          filters: tableFilters,
          sortColumn,
          sortDirection,
          currentTotal: bulkExportRows ? bulkExportRows.length : totalItems,
        }}
        currentColumns={columns}
        currentRows={bulkExportRows ?? tableData}
      />
    )}
    <TablePicker
      isOpen={isTablePickerOpen}
      onClose={() => setIsTablePickerOpen(false)}
      tables={(() => {
        // Prefer schemaMap (cross-schema). Fall back to current-schema tables.
        const fromMap = Object.entries(schemaMap).flatMap(([s, ts]) =>
          (ts as string[]).map((t) => ({ schema: s, table: t }))
        );
        if (fromMap.length > 0) return fromMap;
        return tables.map((t) => ({ schema: selectedSchema, table: t }));
      })()}
      onSelect={(entry) => {
        if (entry.schema !== selectedSchema) {
          handleSchemaChange(entry.schema);
        }
        handleTableSelect(entry.table);
      }}
    />
    {reviewTarget && (
      <ReviewSqlModal
        isOpen={isReviewOpen}
        onClose={() => setIsReviewOpen(false)}
        schema={reviewTarget.schema}
        table={reviewTarget.table}
      />
    )}
    <KeyboardShortcutsHelp
      isOpen={isShortcutsHelpOpen}
      onClose={() => setIsShortcutsHelpOpen(false)}
      shortcuts={shortcuts}
    />
    {selectedTable && (
      <CSVImportDialog
        isOpen={isCSVImportOpen}
        onClose={() => setIsCSVImportOpen(false)}
        tableName={selectedTable}
        schema={selectedSchema}
        columns={schema}
        onComplete={refreshTableData}
      />
    )}
    <TableCreationWizard
      isOpen={isCreateTableOpen}
      onClose={() => setIsCreateTableOpen(false)}
      onComplete={() => loadTables()}
    />
    <BatchExportModal
      isOpen={isBatchExportOpen}
      onClose={() => setIsBatchExportOpen(false)}
      tables={tables}
      schema={selectedSchema}
      databaseType={databaseType}
    />
    </>
  );
}

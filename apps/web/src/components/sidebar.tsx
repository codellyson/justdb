
import React, { useState, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { TableList } from './table-list';
import { SidebarSkeleton } from './skeletons/sidebar-skeleton';
import type { SavedQuery } from '@/types';
import { ArrowRight, ChevronDown, ChevronRight, Code2, Database, Download, Plus, X } from 'lucide-react';
import { Select, Tooltip } from '@codellyson/justui/react';

interface FunctionInfo {
  name: string;
  arguments: string;
  return_type: string;
  language: string;
  kind: string;
}

interface SidebarProps {
  tables: string[];
  selectedTable?: string;
  onTableSelect: (table: string) => void;
  isLoading?: boolean;
  /** Connected database name, shown in the sidebar header band. */
  databaseName?: string;
  schemas?: string[];
  selectedSchema?: string;
  onSchemaChange?: (schema: string) => void;
  views?: string[];
  materializedViews?: string[];
  functions?: FunctionInfo[];
  onCreateTable?: () => void;
  onBatchExport?: () => void;
  // Sidebar prefs for the main "Tables" list. Owned upstream so the dashboard
  // can also record opens when tables are selected from elsewhere (FK panel,
  // table picker, etc.).
  pinnedTables?: string[];
  recentTables?: string[];
  onTogglePin?: (table: string) => void;
  groupByPrefix?: boolean;
  onToggleGroupByPrefix?: () => void;
  rowCounts?: Record<string, number | undefined>;
  // Saved queries — when provided, render a Saved section.
  savedQueries?: SavedQuery[];
  onOpenSavedQuery?: (query: SavedQuery) => void;
  onDeleteSavedQuery?: (id: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  tables,
  selectedTable,
  onTableSelect,
  isLoading = false,
  databaseName,
  schemas,
  selectedSchema = 'public',
  onSchemaChange,
  views = [],
  materializedViews = [],
  functions = [],
  onCreateTable,
  onBatchExport,
  pinnedTables,
  recentTables,
  onTogglePin,
  groupByPrefix,
  onToggleGroupByPrefix,
  rowCounts,
  savedQueries,
  onOpenSavedQuery,
  onDeleteSavedQuery,
}) => {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    tables: true,
    views: true,
    matviews: true,
    functions: false,
    saved: true,
  });

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const [version, setVersion] = useState('');
  useEffect(() => { getVersion().then(setVersion).catch(() => {}); }, []);

  return (
    <aside
      className="w-full bg-bg h-screen flex flex-col border-r border-border"
      aria-label="Database sidebar"
    >
      {/* Header band — matches the main Header height so the top border line
          runs flush across both panes and the sidebar no longer looks headless. */}
      <div className="h-12 flex-shrink-0 flex items-center gap-2 px-3 border-b border-border">
        <Database className="h-4 w-4 text-muted flex-shrink-0" />
        <Tooltip label={databaseName}>
          <span className="text-sm font-medium text-primary truncate" >
            {databaseName || 'Database'}
          </span>
        </Tooltip>
      </div>
      <div className="flex-1 overflow-y-auto p-3 pl-0">
        {schemas && schemas.length > 1 && onSchemaChange && (
          <div className="mb-3">
            <label className="block text-meta uppercase tracking-wider font-semibold text-muted mb-1.5 px-1">
              Schema
            </label>
            <div className="relative">
              <Select
                value={selectedSchema}
                onChange={onSchemaChange}
                options={schemas.map((schema) => ({ value: schema, label: schema }))}
                size="xs"
                aria-label="Select database schema"
                className="w-full text-xs bg-bg-secondary/50"
              />
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted pointer-events-none" />
            </div>
          </div>
        )}

        {isLoading ? (
          <SidebarSkeleton />
        ) : (
          <div className="space-y-1">
            <SidebarSection
              title="Tables"
              count={tables.length}
              icon="T"
              isExpanded={expandedSections.tables}
              onToggle={() => toggleSection('tables')}
              onAction={onCreateTable}
              actionLabel="Create table"
              extraActions={
                onBatchExport && tables.length > 0 ? (
                  <Tooltip label="Batch export tables">
                    <button
                      onClick={(e) => { e.stopPropagation(); onBatchExport(); }}
                      className="p-1 text-muted/0 group-hover/section:text-muted hover:!text-accent rounded-sm transition-colors"
                      aria-label="Batch export tables"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  </Tooltip>
                ) : undefined
              }
            >
              <TableList
                tables={tables}
                selectedTable={selectedTable}
                onSelect={onTableSelect}
                pinned={pinnedTables}
                recent={recentTables}
                onTogglePin={onTogglePin}
                groupByPrefix={groupByPrefix}
                onToggleGroupByPrefix={onToggleGroupByPrefix}
                rowCounts={rowCounts}
              />
            </SidebarSection>

            {views.length > 0 && (
              <SidebarSection
                title="Views"
                count={views.length}
                icon="V"
                isExpanded={expandedSections.views}
                onToggle={() => toggleSection('views')}
              >
                <TableList
                  tables={views}
                  selectedTable={selectedTable}
                  onSelect={onTableSelect}
                />
              </SidebarSection>
            )}

            {materializedViews.length > 0 && (
              <SidebarSection
                title="Mat. Views"
                count={materializedViews.length}
                icon="MV"
                isExpanded={expandedSections.matviews}
                onToggle={() => toggleSection('matviews')}
              >
                <TableList
                  tables={materializedViews}
                  selectedTable={selectedTable}
                  onSelect={onTableSelect}
                />
              </SidebarSection>
            )}

            {savedQueries && savedQueries.length > 0 && onOpenSavedQuery && (
              <SidebarSection
                title="Saved"
                count={savedQueries.length}
                icon="S"
                isExpanded={expandedSections.saved}
                onToggle={() => toggleSection('saved')}
              >
                <ul className="space-y-px">
                  {savedQueries.map((q) => (
                    <li key={q.id} className="group flex items-center gap-1">
                      <Tooltip label={q.query}>
                        <button
                          onClick={() => onOpenSavedQuery(q)}
                          className="flex-1 text-left px-2.5 py-1.5 text-[13px] rounded-md text-secondary hover:text-primary hover:bg-bg-secondary transition-colors truncate"
                        >
                          <span className="truncate">{q.name}</span>
                        </button>
                      </Tooltip>
                      {onDeleteSavedQuery && (
                        <Tooltip label="Delete saved query">
                          <button
                            onClick={(e) => { e.stopPropagation(); onDeleteSavedQuery(q.id); }}
                            className="p-1 text-muted/0 group-hover:text-muted hover:!text-danger transition-colors"
                            aria-label="Delete saved query"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Tooltip>
                      )}
                    </li>
                  ))}
                </ul>
              </SidebarSection>
            )}

            {functions.length > 0 && (
              <SidebarSection
                title="Functions"
                count={functions.length}
                icon="F"
                isExpanded={expandedSections.functions}
                onToggle={() => toggleSection('functions')}
              >
                <div className="space-y-px">
                  {functions.map((fn, i) => (
                    <div
                      key={i}
                      className="group px-2.5 py-1.5 text-[13px] rounded-md hover:bg-bg-secondary flex items-start gap-2 transition-colors cursor-default"
                    >
                      <Code2 className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-muted group-hover:text-secondary transition-colors" />
                      <div className="min-w-0">
                        <div className="font-medium text-secondary group-hover:text-primary truncate transition-colors">{fn.name}</div>
                        <div className="text-meta text-muted font-mono truncate">
                          ({fn.arguments}) <ArrowRight className="inline h-3 w-3 align-middle" /> {fn.return_type}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </SidebarSection>
            )}
          </div>
        )}
      </div>
      {version && (
        <div className="border-t border-border px-3 py-2 text-meta text-muted font-mono">
          v{version}
        </div>
      )}
    </aside>
  );
};

const SidebarSection: React.FC<{
  title: string;
  count: number;
  icon: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  onAction?: () => void;
  actionLabel?: string;
  extraActions?: React.ReactNode;
}> = ({ title, count, icon: _icon, isExpanded, onToggle, children, onAction, actionLabel, extraActions }) => (
  <div>
    <div className="flex items-center group/section">
      <button
        onClick={onToggle}
        className="flex-1 flex items-center gap-1 py-1.5 px-1.5 text-meta uppercase tracking-wider font-semibold text-muted hover:text-secondary transition-colors"
        aria-expanded={isExpanded}
      >
        <ChevronRight className={`h-3 w-3 text-muted/60 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
        <span>{title}</span>
        <span className="text-muted/50 font-normal">{count}</span>
      </button>
      {extraActions}
      {onAction && (
        <Tooltip label={actionLabel || "Add"}>
          <button
            onClick={(e) => { e.stopPropagation(); onAction(); }}
            className="p-1 text-muted/0 group-hover/section:text-muted hover:!text-accent rounded-sm transition-colors"
            aria-label={actionLabel || "Add"}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      )}
    </div>
    <div className="sidebar-section-content" data-expanded={isExpanded} aria-hidden={!isExpanded} inert={!isExpanded}>
      <div className="min-h-0 overflow-hidden"><div className="pt-0.5 ml-1">{children}</div></div>
    </div>
  </div>
);

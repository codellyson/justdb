
import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { EditorView } from '@codemirror/view';
import { QuerySplit } from './query-split';
import { Button } from './ui/button';
import { QueryPlanContent } from './query-plan-content';
import { queryColumnTypes, formatQueryDuration } from '@/lib/query-presentation';
import { QueryResultGrid } from './query-result-grid';
import { ErrorState } from './error-state';
import { SqlEditor } from './sql-editor';
import { useQueryHistory } from '../hooks/use-query-history';
import { QueryHistory } from './query-history';
import { formatSQL } from '@/lib/sql-formatter';
import { explainStatement } from '@/lib/smart-query';
import { getStatementAtCursor, splitSqlStatements } from '@/lib/sql-statements';
import { db } from '@/lib/db';
import { ai } from '@/lib/ai';
import { getResultRowCap } from '@/lib/app-settings';
import { track, bucketDuration } from '@/lib/telemetry';
import { useConnection } from '../contexts/connection-context';
import { useDashboardActions, useDashboardState } from '../contexts/dashboard-context';
import { useToast } from '../contexts/toast-context';
import { usePendingChanges } from '../contexts/pending-changes-context';
import { useQueries, useQuery } from '@tanstack/react-query';
import { analyzeEditability, describeReason, type EditabilityResult } from '@/lib/query-editability';
import type { QueryFieldInfo } from '@/lib/db-provider';
import type { ColumnInfo } from '@/types';
import { QueryExecutionConfirmation } from './query-execution-confirmation';
import { TabBar, type Tab } from './tab-bar';
import { SaveQueryDialog } from './save-query-dialog';
import { ExportModal } from './export-modal';
import { AiSqlBar } from './ai-sql-bar';
import { useAiSchemaText } from '../hooks/use-ai-schema';
import { AlignLeft, BarChart3, Bookmark, Clock, Download, Play, RefreshCw, Sparkles, X } from 'lucide-react';
import { Input, Tooltip } from '@codellyson/justui/react';

interface PendingQueryConfirmation {
  sql: string;
  kind: 'write' | 'ddl';
  statement: string;
  isBulkWrite: boolean;
  requiresTypedConfirmation: boolean;
  reason?: string;
}

// 1k wide rows (16+ varchar cols on a remote DB) hung the webview after
// render — no console error, just frozen. The cap (default 200) keeps the
// grid responsive even on heavy result shapes; configurable in Settings →
// Data. Add an explicit LIMIT to pull more.

interface ResultTab {
  id: string;
  label: string;
  /** the exact SQL that produced this tab — used for dedup and refresh */
  sql: string;
  rows: any[];
  columns: string[];
  columnTypes: Record<string, string>;
  executionTime: number;
  /** field metadata returned by the driver — drives editability detection */
  fields?: QueryFieldInfo[];
  /** Total rows returned by query (before truncation) */
  totalRows?: number;
  /** Whether results were truncated to MAX_RESULT_ROWS */
  truncated?: boolean;
}

interface QueryEditorProps {
  isActive?: boolean;
  tabId?: string;
  onForeignKeyClick?: (args: {
    sourceColumn: string;
    fk: { schema: string; table: string; column: string };
    value: any;
  }) => void;
  onEditableTargetChange?: (target: { schema: string; table: string } | null) => void;
}

const editorStorageKey = (tabId: string) => `dbview-editor-${tabId}`;

export const QueryEditor: React.FC<QueryEditorProps> = ({
  isActive = true,
  tabId,
  onForeignKeyClick,
  onEditableTargetChange,
}) => {
  const { databaseType } = useConnection();
  const { schemaMap, tables, selectedSchema } = useDashboardState();
  const { saveQuery } = useDashboardActions();
  const { addToast } = useToast();
  const pending = usePendingChanges();
  const [query, setQuery] = useState<string>(() => {
    if (!tabId || typeof window === 'undefined') return '';
    try {
      return localStorage.getItem(editorStorageKey(tabId)) ?? '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    if (!tabId || typeof window === 'undefined') return;
    try {
      if (query) {
        localStorage.setItem(editorStorageKey(tabId), query);
      } else {
        localStorage.removeItem(editorStorageKey(tabId));
      }
    } catch {
      // ignore
    }
  }, [query, tabId]);
  const [error, setError] = useState<string | null>(null);
  const [failedSql, setFailedSql] = useState<string | null>(null);
  const [isFixing, setIsFixing] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [explainData, setExplainData] = useState<{ plan: any; executionTime: number; sql: string } | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const [outputView, setOutputView] = useState<'results' | 'plan'>('results');
  const [interpretation, setInterpretation] = useState<string | null>(null);
  const [isInterpreting, setIsInterpreting] = useState(false);

  useEffect(() => {
    ai.status().then((s) => setAiConfigured(!!s.configured)).catch(() => {});
  }, []);
  const [showHistory, setShowHistory] = useState(false);
  const [showAiGenerate, setShowAiGenerate] = useState(false);
  const editorViewRef = useRef<EditorView | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(0);
  const currentStatement = getStatementAtCursor(query, cursorPosition);
  const statementHelp = currentStatement ? explainStatement(currentStatement.text) : null;
  const [pendingQueryConfirm, setPendingQueryConfirm] = useState<PendingQueryConfirmation | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);

  // Result tabs
  const [resultTabs, setResultTabs] = useState<ResultTab[]>([]);
  const [activeResultTabId, setActiveResultTabId] = useState<string | undefined>();
  const [resultSearchQuery, setResultSearchQuery] = useState('');
  const resultSearchInputRef = useRef<HTMLInputElement>(null);
  const [isSaveQueryOpen, setIsSaveQueryOpen] = useState(false);
  const [pendingSaveQuery, setPendingSaveQuery] = useState('');

  const getExecutableQuery = useCallback(() => {
    const view = editorViewRef.current;
    if (view) {
      const { from, to, head } = view.state.selection.main;
      if (from !== to) {
        return view.state.sliceDoc(from, to).trim();
      }
      // No selection → run only the statement at the cursor. Use the live
      // editor doc rather than the throttled `query` state so we always get
      // the current text.
      const doc = view.state.doc.toString();
      const stmt = getStatementAtCursor(doc, head);
      if (stmt) return stmt.text;
    }
    return query.trim();
  }, [query]);

  const autocompleteSchema = useMemo(() => {
    // Build a flat { table: columns[] } map and also a nested { schema: { table: columns[] } }
    // so CodeMirror can resolve both bare-table references and schema-qualified ones.
    const flat: Record<string, string[]> =
      Object.keys(schemaMap).length > 0
        ? schemaMap
        : tables.reduce<Record<string, string[]>>((acc, t) => {
            acc[t] = [];
            return acc;
          }, {});
    return { ...flat, [selectedSchema]: flat };
  }, [schemaMap, tables, selectedSchema]);

  // Typed schema (column types + PK/FK) handed to the AI for grounding.
  const aiSchemaText = useAiSchemaText();

  // AI-generated SQL lands in the editor — it never runs automatically.
  // The user reviews it and runs it through the normal classifier/confirm
  // gate, same as anything they'd type.
  const handleAiGenerated = useCallback((sql: string, explanation: string) => {
    setQuery(sql);
    setError(null);
    if (explanation.trim()) addToast(explanation, 'info');
  }, [addToast]);

  const { history, addQuery, favoriteQuery, deleteQuery, clearHistory } = useQueryHistory();

  const parseColumnTypes = (data: { fields?: QueryFieldInfo[] }) => queryColumnTypes(data.fields, databaseType);

  // Run a query and write the results to a tab. Re-running the same SQL
  // string focuses the existing tab and refreshes its rows in place rather
  // than creating a duplicate. This is the spec from the doc: every run
  // gets a tab; results never clobber.
  const executeQueryRequest = useCallback(
    async (execQuery: string, confirmed = false) => {
      setIsExecuting(true);
      setError(null);
      setFailedSql(null);

      try {
        const data = await db.runQuery(execQuery, confirmed);

        if (data.needsConfirmation) {
          const c = data.classification;
          setPendingQueryConfirm({
            sql: data.preview,
            kind: c.kind,
            statement: c.statement,
            isBulkWrite: c.isBulkWrite,
            requiresTypedConfirmation: c.requiresTypedConfirmation,
            reason: c.reason,
          });
          return;
        }

        const maxRows = getResultRowCap();
        const occurrences = new Map<string, number>();
        const completedTabs: ResultTab[] = data.results.map((result, index) => {
          const allRows = result.rows || [];
          const totalRows = allRows.length;
          const truncated = totalRows > maxRows;
          const rows = truncated ? allRows.slice(0, maxRows) : allRows;
          const occurrence = occurrences.get(result.sql) ?? 0;
          occurrences.set(result.sql, occurrence + 1);
          const existing = resultTabs.filter(tab => tab.sql === result.sql)[occurrence];
          const preview = result.sql.length > 36 ? result.sql.slice(0, 36) + '…' : result.sql;
          if (truncated) {
            addToast(`Query ${index + 1}: showing first ${maxRows.toLocaleString()} of ${totalRows.toLocaleString()} rows.`, 'warning');
          }
          return {
            id: existing?.id ?? `qr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            label: data.results.length > 1 ? `${index + 1} · ${preview}` : preview,
            sql: result.sql,
            rows,
            columns: rows.length > 0 ? Object.keys(rows[0]) : [],
            columnTypes: parseColumnTypes(result),
            fields: result.fields as QueryFieldInfo[] | undefined,
            executionTime: result.executionTime || 0,
            totalRows,
            truncated,
          };
        });
        setResultTabs(prev => {
          const next = [...prev];
          for (const tab of completedTabs) {
            const index = next.findIndex(existing => existing.id === tab.id);
            if (index >= 0) next[index] = tab;
            else next.push(tab);
          }
          return next;
        });
        if (completedTabs.length) setActiveResultTabId(completedTabs[0].id);
        const execTime = data.executionTime || 0;
        const totalRows = completedTabs.reduce((count, tab) => count + (tab.totalRows ?? tab.rows.length), 0);
        setOutputView('results');
        addQuery(execQuery, execTime, totalRows);
        void track({ name: 'query_executed', duration_bucket: bucketDuration(execTime), has_rows: totalRows > 0 });
      } catch (err: any) {
        setError(err.message || 'Query execution failed');
        setFailedSql(execQuery);
        void track({ name: 'query_failed' });
      } finally {
        setIsExecuting(false);
      }
    },
    [addQuery, resultTabs, databaseType]
  );

  // Send the failing SQL + error to the model and drop a corrected query into
  // the editor (never auto-run — it goes through the normal confirm gate).
  const handleFixWithAi = useCallback(async () => {
    const sql = failedSql ?? query.trim();
    if (!sql || !error || isFixing) return;
    setIsFixing(true);
    try {
      const prompt =
        `The following ${databaseType} SQL query failed. Return a corrected version ` +
        `that runs successfully while preserving the original intent.\n\n` +
        `Error:\n${error}\n\nQuery:\n${sql}`;
      const res = await ai.generateSql({ prompt, dialect: databaseType, schema: aiSchemaText });
      if (res.sql.trim()) {
        setQuery(res.sql);
        setError(null);
        setFailedSql(null);
        if (res.explanation.trim()) addToast(res.explanation, 'info');
      } else {
        addToast(res.explanation || 'AI could not produce a fix.', 'warning');
      }
    } catch (e: any) {
      addToast(e?.message || 'AI fix failed', 'error');
    } finally {
      setIsFixing(false);
    }
  }, [failedSql, query, error, isFixing, databaseType, aiSchemaText, addToast]);

  // Run EXPLAIN on the current query and show the plan.
  const handleExplain = useCallback(async () => {
    const sql = getExecutableQuery();
    if (!sql || isExplaining) return;
    setIsExplaining(true);
    setError(null);
    setInterpretation(null);
    try {
      const res: any = await db.explain(sql);
      setExplainData({ plan: res.plan, executionTime: res.executionTime ?? 0, sql });
      setOutputView('plan');
    } catch (e: any) {
      setError(e?.message || 'EXPLAIN failed');
      setExplainData(null);
    } finally {
      setIsExplaining(false);
    }
  }, [getExecutableQuery, isExplaining]);

  // Hand the plan to the model for a plain-English read + index suggestions.
  const handleInterpretPlan = useCallback(async () => {
    if (!explainData || isInterpreting) return;
    setIsInterpreting(true);
    try {
      const prompt =
        `Interpret this ${databaseType} EXPLAIN plan for the query below. Identify the ` +
        `main cost driver / bottleneck, any sequential scans or large row-estimate ` +
        `mismatches, and suggest concrete indexes or query rewrites if warranted. Be ` +
        `concise. Do not run any queries — everything you need is provided.\n\n` +
        `Query:\n${explainData.sql}\n\nPlan (JSON):\n${JSON.stringify(explainData.plan)}`;
      const res = await ai.chat({
        messages: [{ role: 'user', content: prompt }],
        dialect: databaseType,
        schema: aiSchemaText,
      });
      setInterpretation(res.reply || 'No interpretation returned.');
    } catch (e: any) {
      addToast(e?.message || 'AI interpretation failed', 'error');
    } finally {
      setIsInterpreting(false);
    }
  }, [explainData, isInterpreting, databaseType, aiSchemaText, addToast]);

  const handleExecute = async () => {
    const execQuery = getExecutableQuery();
    if (!execQuery) return;
    await executeQueryRequest(execQuery);
  };

  const handleConfirmQueryExecution = useCallback(async () => {
    if (!pendingQueryConfirm) return;
    const sql = pendingQueryConfirm.sql;
    setPendingQueryConfirm(null);
    await executeQueryRequest(sql, true);
  }, [pendingQueryConfirm, executeQueryRequest]);

  useHotkeys(
    'ctrl+enter, meta+enter',
    (e) => {
      e.preventDefault();
      handleExecute();
    },
    {
      enabled: isActive,
      enableOnFormTags: true,
      enableOnContentEditable: true,
      preventDefault: true,
    }
  );

  useHotkeys(
    'ctrl+f, meta+f',
    (e) => {
      e.preventDefault();
      resultSearchInputRef.current?.focus();
      resultSearchInputRef.current?.select();
    },
    {
      enabled: isActive && resultTabs.length > 0,
      preventDefault: true,
    }
  );

  // Look up here so the rest of the component can read derived state from
  // the active tab without scattered `find` calls.
  const activeTab = resultTabs.find((t) => t.id === activeResultTabId);
  const activeFields = activeTab?.fields;
  const activeSql = activeTab?.sql ?? '';

  // Detect the unique source (schema, table) from the result fields.
  const candidateSource = useMemo(() => {
    if (!activeFields || activeFields.length === 0) return null;
    const seen = new Set<string>();
    let schema = '';
    let table = '';
    for (const f of activeFields) {
      if (f.source) {
        const key = `${f.source.schema}.${f.source.table}`;
        if (!seen.has(key)) {
          seen.add(key);
          schema = f.source.schema;
          table = f.source.table;
        }
      }
    }
    return seen.size === 1 ? { schema, table } : null;
  }, [activeFields]);

  const sourceSchemaQuery = useQuery({
    queryKey: ['queryResultSourceSchema', candidateSource?.schema, candidateSource?.table],
    queryFn: async () => {
      const cols = await db.tableSchema(candidateSource!.table, candidateSource!.schema);
      return (cols as any[]).map((row: any) => ({
        name: row.column_name ?? row.name,
        type: row.data_type ?? row.type,
        nullable: row.is_nullable === 'YES' || row.nullable === true,
        default: row.column_default ?? row.default ?? null,
        isPrimaryKey: row.is_primary_key ?? row.isPrimaryKey ?? false,
      })) as ColumnInfo[];
    },
    enabled: !!candidateSource,
  });

  const sourceColumnInfo = useMemo(() => sourceSchemaQuery.data ?? [], [sourceSchemaQuery.data]);
  const sourcePrimaryKeys = useMemo(
    () => sourceColumnInfo.filter((c) => c.isPrimaryKey).map((c) => c.name),
    [sourceColumnInfo]
  );

  const uniqueSourceTables = useMemo(() => {
    if (!activeFields || activeFields.length === 0) return [] as Array<{ schema: string; table: string }>;
    const seen = new Set<string>();
    const out: Array<{ schema: string; table: string }> = [];
    for (const f of activeFields) {
      if (!f.source) continue;
      const key = `${f.source.schema}.${f.source.table}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ schema: f.source.schema, table: f.source.table });
    }
    return out;
  }, [activeFields]);

  const sourceRelationshipQueries = useQueries({
    queries: uniqueSourceTables.map((st) => ({
      queryKey: ['queryResultRelationships', st.schema, st.table] as const,
      queryFn: async () => {
        const data = await db.relationships(st.table, st.schema);
        return ((data.relationships ?? []) as Array<{
          source_column: string;
          target_schema: string;
          target_table: string;
          target_column: string;
        }>);
      },
      staleTime: 60_000,
    })),
  });

  const resultForeignKeys = useMemo(() => {
    if (!activeFields || activeFields.length === 0) return {} as Record<string, { schema: string; table: string; column: string }>;
    const relsBySource: Record<string, Record<string, { schema: string; table: string; column: string }>> = {};
    uniqueSourceTables.forEach((st, i) => {
      const data = sourceRelationshipQueries[i]?.data;
      if (!data) return;
      const map: Record<string, { schema: string; table: string; column: string }> = {};
      for (const r of data) {
        if (!r.source_column || !r.target_table) continue;
        map[r.source_column] = {
          schema: r.target_schema || st.schema,
          table: r.target_table,
          column: r.target_column,
        };
      }
      relsBySource[`${st.schema}.${st.table}`] = map;
    });
    const out: Record<string, { schema: string; table: string; column: string }> = {};
    for (const f of activeFields) {
      if (!f.source) continue;
      const sourceMap = relsBySource[`${f.source.schema}.${f.source.table}`];
      if (!sourceMap) continue;
      const fk = sourceMap[f.source.column];
      if (fk) out[f.name] = fk;
    }
    return out;
  }, [activeFields, uniqueSourceTables, sourceRelationshipQueries]);

  const editability: EditabilityResult = useMemo(() => {
    return analyzeEditability({
      sql: activeSql,
      fields: activeFields,
      getPrimaryKeys: (schema, table) => {
        if (
          candidateSource?.schema === schema &&
          candidateSource?.table === table &&
          sourcePrimaryKeys.length > 0
        ) {
          return sourcePrimaryKeys;
        }
        return undefined;
      },
    });
  }, [activeSql, activeFields, candidateSource, sourcePrimaryKeys]);

  // When editable: derive per-row-lookup PKs (result-aliased) and
  // the set of read-only result columns (computed expressions, etc.).
  const editableMeta = useMemo(() => {
    if (!editability.editable) return null;
    if (!activeTab) return null;
    const { columnToSource, primaryKeys: basePks, schema, table } = editability;
    const readOnlyResultColumns = activeTab.columns.filter((c) => !(c in columnToSource));
    // Reverse map: base column → result column. Used to read a row's PK
    // values via the alias when the result has aliased columns.
    const sourceToResult: Record<string, string> = {};
    for (const [resultCol, baseCol] of Object.entries(columnToSource)) {
      sourceToResult[baseCol] = resultCol;
    }
    return { schema, table, columnToSource, sourceToResult, basePrimaryKeys: basePks, readOnlyResultColumns };
  }, [editability, activeTab]);

  // Build the row's primary-key map keyed by *base* column names, using the
  // alias map to read values out of result-aliased rows. This is what the
  // pending-changes store uses, so passing this to DataTable lets row
  // highlighting line up with staged edits.
  const pksFromRow = useCallback(
    (row: any): Record<string, any> => {
      if (!editableMeta) return {};
      const out: Record<string, any> = {};
      for (const basePk of editableMeta.basePrimaryKeys) {
        const resultCol = editableMeta.sourceToResult[basePk];
        if (!resultCol) continue;
        out[basePk] = row[resultCol];
      }
      return out;
    },
    [editableMeta]
  );

  const handleQueryCellUpdate = useCallback(
    ({ pks, column, original, next }: { pks: Record<string, any>; column: string; original: any; next: any }) => {
      if (!editableMeta) return;
      const baseColumn = editableMeta.columnToSource[column];
      if (!baseColumn) return;
      pending.stageEdit({
        schema: editableMeta.schema,
        table: editableMeta.table,
        pks,
        column: baseColumn,
        original,
        next,
      });
    },
    [editableMeta, pending]
  );

  const handleQueryRowDelete = useCallback(
    ({ pks, snapshot }: { pks: Record<string, any>; snapshot: Record<string, any> }) => {
      if (!editableMeta) return;
      pending.stageDelete({
        schema: editableMeta.schema,
        table: editableMeta.table,
        pks,
        snapshot,
      });
    },
    [editableMeta, pending]
  );

  // Re-run the query backing the active tab and refresh its rows in place.
  const refreshResults = useCallback(async () => {
    if (!activeTab) return;
    await executeQueryRequest(activeTab.sql);
  }, [activeTab, executeQueryRequest]);

  // Report the current editable target to the parent (Dashboard) so the
  // PendingChangesBar / Review SQL modal can scope to this query's source
  // table when the editor tab is active.
  useEffect(() => {
    if (!isActive || !onEditableTargetChange) return;
    if (editableMeta) {
      onEditableTargetChange({ schema: editableMeta.schema, table: editableMeta.table });
    } else {
      onEditableTargetChange(null);
    }
    return () => {
      if (onEditableTargetChange) onEditableTargetChange(null);
    };
  }, [isActive, editableMeta, onEditableTargetChange]);

  const closeResultTab = useCallback((tabId: string) => {
    setResultTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (tabId === activeResultTabId) {
        const closedIndex = prev.findIndex((t) => t.id === tabId);
        const newActive = next[Math.min(closedIndex, next.length - 1)];
        setActiveResultTabId(newActive?.id);
      }
      return next;
    });
  }, [activeResultTabId]);

  const handleClear = () => {
    setQuery('');
    setError(null);
  };

  const tabBarTabs: Tab[] = resultTabs.map((t) => ({
    id: t.id,
    label: t.label,
    type: 'query' as const,
  }));

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <QuerySplit editor={
      <div className="flex flex-col h-full min-h-0 gap-2 overflow-auto">
          {showAiGenerate && (
            <AiSqlBar
              dialect={databaseType}
              schema={aiSchemaText}
              onGenerated={handleAiGenerated}
              disabled={isExecuting}
            />
          )}
          <div className="flex flex-col flex-1 min-h-[100px] border border-border rounded-lg overflow-hidden">
            <div className="flex shrink-0 items-center gap-1 px-2 py-1.5 bg-bg-secondary/40 border-b border-border overflow-x-auto">
              <Button size="sm" onClick={handleExecute} disabled={isExecuting || !query.trim()} isLoading={isExecuting}>
                <Play className="size-3.5" aria-hidden="true" />
                {hasSelection ? 'Run selection' : 'Run query'}
                <kbd className="ml-2 text-meta opacity-70">Ctrl ↵</kbd>
              </Button>
              {splitSqlStatements(query).length > 1 && <Button size="sm" variant="secondary" disabled={isExecuting || !query.trim()} onClick={() => void executeQueryRequest(editorViewRef.current?.state.doc.toString() ?? query)}>Run all</Button>}
              <span className="mx-1 h-5 border-l border-border" aria-hidden="true" />
              <Tooltip label="Generate SQL with AI">
                <button
                  aria-label="Generate SQL with AI"
                  onClick={() => setShowAiGenerate((v) => !v)}
                  className={`w-7 h-7 flex items-center justify-center rounded-sm transition-colors ${showAiGenerate ? 'text-accent bg-accent/15' : 'text-muted hover:text-accent hover:bg-accent/10'}`}
                  aria-pressed={showAiGenerate}
                >
                  <Sparkles className="w-4 h-4" />
                </button>
              </Tooltip>
              <span className="mx-1 h-5 border-l border-border" aria-hidden="true" />
              <Tooltip label="Format SQL">
                <button
                  aria-label="Format SQL"
                  onClick={() => setQuery(formatSQL(query, databaseType))}
                  disabled={isExecuting || !query.trim()}
                  className="w-7 h-7 flex items-center justify-center rounded-sm text-muted hover:text-primary hover:bg-bg-secondary disabled:opacity-30 transition-colors"
                >
                  <AlignLeft className="w-4 h-4" />
                </button>
              </Tooltip>
              <Tooltip label="Explain query plan">
                <button
                  aria-label="Explain query plan"
                  onClick={handleExplain}
                  disabled={isExecuting || isExplaining || !query.trim()}
                  className="w-7 h-7 flex items-center justify-center rounded-sm text-muted hover:text-accent hover:bg-accent/10 disabled:opacity-30 transition-colors"
                >
                  <BarChart3 className="w-4 h-4" />
                </button>
              </Tooltip>
              <Tooltip label="Save query">
                <button
                  aria-label="Save query"
                  onClick={() => {
                    setPendingSaveQuery(query);
                    setIsSaveQueryOpen(true);
                  }}
                  disabled={isExecuting || !query.trim()}
                  className="w-7 h-7 flex items-center justify-center rounded-sm text-muted hover:text-accent hover:bg-accent/10 disabled:opacity-30 transition-colors"
                >
                  <Bookmark className="w-4 h-4" />
                </button>
              </Tooltip>
              <Tooltip label="Clear">
                <button
                  aria-label="Clear SQL"
                  onClick={handleClear}
                  disabled={isExecuting}
                  className="w-7 h-7 flex items-center justify-center rounded-sm text-muted hover:text-danger hover:bg-danger/10 disabled:opacity-30 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </Tooltip>
              <Tooltip label="History">
                <button
                  aria-label="Query history"
                  onClick={() => setShowHistory(!showHistory)}
                  className={`w-7 h-7 flex items-center justify-center rounded-sm transition-colors ${showHistory ? 'text-accent bg-accent/15' : 'text-muted hover:text-primary hover:bg-bg-secondary'}`}
                >
                  <Clock className="w-4 h-4" />
                </button>
              </Tooltip>
            </div>
            <div className="flex-1 min-w-0 min-h-0">
              <SqlEditor
                value={query}
                onChange={setQuery}
                disabled={isExecuting}
                schema={autocompleteSchema}
                defaultSchema={selectedSchema}
                editorRef={editorViewRef}
                onSelectionChange={setHasSelection}
                onCursorChange={setCursorPosition}
              />
            </div>
            {statementHelp && (
              <details className="shrink-0 border-t border-border px-3 py-2 text-support text-secondary">
                <summary className="cursor-pointer w-fit rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">Explain statement · {statementHelp.title}</summary>
                <p className="pt-2 text-sm leading-relaxed max-w-2xl">{statementHelp.description}</p>
                <p className="pt-1 text-meta text-muted">Syntax guide · No query executed. Hover a SQL keyword or function to explain that part.</p>
              </details>
            )}
          </div>
          {error && (
            <ErrorState
              message={error}
              onRetry={query.trim() ? handleExecute : undefined}
              onDismiss={() => { setError(null); setFailedSql(null); }}
              action={aiConfigured ? (
                <Tooltip label="Send the error and query to the AI for a fix">
                  <button
                    onClick={handleFixWithAi}
                    disabled={isFixing}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-border text-secondary hover:bg-bg-secondary disabled:opacity-50 transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    {isFixing ? 'Fixing…' : 'Fix with AI'}
                  </button>
                </Tooltip>
              ) : undefined}
            />
          )}
          {showHistory && (
            <div className="max-h-48 overflow-auto shrink-0"><QueryHistory
              entries={history}
              onSelect={(sql) => {
                setQuery(sql);
                setShowHistory(false);
              }}
              onFavorite={favoriteQuery}
              onDelete={deleteQuery}
              onClear={clearHistory}
              onSave={(sql) => {
                setPendingSaveQuery(sql);
                setIsSaveQueryOpen(true);
              }}
            /></div>
          )}
      </div>

      } output={
      <div className="flex h-full min-h-0 flex-col gap-2">
        <div className="flex shrink-0 gap-1 border-b border-border" role="tablist" aria-label="Query output">
          {(['results', 'plan'] as const).map(value => (
            <button key={value} type="button" role="tab" aria-selected={outputView === value}
              tabIndex={outputView === value ? 0 : -1}
              aria-controls={`query-${tabId}-${value}`} id={`query-${tabId}-${value}-tab`}
              disabled={value === 'plan' && !explainData}
              onClick={() => setOutputView(value)}
              onKeyDown={event => {
                if (explainData && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                  event.preventDefault();
                  const next = value === 'results' ? 'plan' : 'results';
                  setOutputView(next);
                  document.getElementById(`query-${tabId}-${next}-tab`)?.focus();
                }
              }}
              className={`min-h-10 border-b-2 px-4 text-sm font-medium transition-colors disabled:opacity-40 ${outputView === value ? 'border-accent text-primary' : 'border-transparent text-muted hover:text-primary'}`}>
              {value === 'results' ? 'Results' : 'Query plan'}
            </button>
          ))}
        </div>
      {/* EXPLAIN plan panel */}
      {explainData && (
        <section id={`query-${tabId}-plan`} role="tabpanel" aria-labelledby={`query-${tabId}-plan-tab`} className={outputView === 'plan' ? 'flex-1 min-h-0 overflow-auto p-3' : 'hidden'}>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted font-mono">Planning: {formatQueryDuration(explainData.executionTime)}</span>
              <div className="flex items-center gap-2">
                {aiConfigured && (
                  <Tooltip label="Have the AI read the plan and suggest improvements">
                    <button
                      onClick={handleInterpretPlan}
                      disabled={isInterpreting}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-border text-secondary hover:bg-bg-secondary disabled:opacity-50 transition-colors"
                    >
                      <Sparkles className="w-3 h-3" />
                      {isInterpreting ? 'Interpreting…' : 'Interpret with AI'}
                    </button>
                  </Tooltip>
                )}
                <Tooltip label="Close plan">
                  <button
                    onClick={() => { setExplainData(null); setInterpretation(null); setOutputView('results'); }}
                    className="w-6 h-6 flex items-center justify-center rounded-sm text-muted hover:text-primary hover:bg-bg-secondary transition-colors"
                    aria-label="Close plan"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
              </div>
            </div>
            <QueryPlanContent plan={explainData.plan} />
            {interpretation && (
              <div className="border-t border-border pt-3 text-sm text-primary whitespace-pre-wrap leading-relaxed">
                {interpretation}
              </div>
            )}
          </div>
        </section>
      )}

      <section id={`query-${tabId}-results`} role="tabpanel" aria-labelledby={`query-${tabId}-results-tab`} className={outputView === 'results' ? 'flex flex-col flex-1 min-h-0 gap-2' : 'hidden'}>
      {/* Result tabs bar */}
      {resultTabs.length > 0 && (
        <TabBar
          tabs={tabBarTabs}
          activeTabId={activeResultTabId}
          onTabSelect={(tabId) => setActiveResultTabId(tabId)}
          onTabClose={closeResultTab}
          onTabCloseAll={() => { setResultTabs([]); setActiveResultTabId(undefined); }}
        />
      )}

      {/* Query execution indicator */}
      {isExecuting && (
        <div className="flex items-center gap-3 py-3 px-1">
          <div className="relative h-1 flex-1 bg-bg-secondary rounded-full overflow-hidden">
            <div className="absolute inset-y-0 left-0 w-1/3 bg-accent rounded-full animate-[shimmer_1.2s_ease-in-out_infinite]" />
          </div>
          <span className="text-xs text-muted flex-shrink-0">Running query...</span>
          <style>{`
            @keyframes shimmer {
              0% { transform: translateX(-100%); }
              100% { transform: translateX(400%); }
            }
          `}</style>
        </div>
      )}

      {/* Active result tab content */}
      {activeTab && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex shrink-0 flex-wrap items-center justify-between mb-2 gap-2">
            <span className="text-sm text-muted">
              {activeTab.truncated ? (
                <>
                  Showing {activeTab.rows.length.toLocaleString()} of {activeTab.totalRows?.toLocaleString()} rows
                  <span className="ml-1.5 text-warning">(truncated)</span>
                </>
              ) : (
                <>{activeTab.rows.length.toLocaleString()} {activeTab.rows.length === 1 ? 'row' : 'rows'} returned</>
              )}
            </span>
            <div className="flex items-center gap-2">
              {editableMeta ? (
                <Tooltip label={`Editable — ${editableMeta.schema}.${editableMeta.table}`}>
                  <span
                    className="text-meta font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-sm bg-accent/10 text-accent"
                  >
                    Editable
                  </span>
                </Tooltip>
              ) : editability.editable === false && activeFields && activeFields.length > 0 ? (
                <Tooltip
                  label={`Read-only — ${describeReason(editability.reason)}${
                    editability.detail ? ` (${editability.detail})` : ''
                  }`}
                >
                  <span className="text-meta font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-sm bg-bg-secondary text-muted">
                    Read-only
                  </span>
                </Tooltip>
              ) : null}
              <Input
                ref={resultSearchInputRef}
                value={resultSearchQuery}
                onChange={setResultSearchQuery}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setResultSearchQuery('');
                    resultSearchInputRef.current?.blur();
                  }
                }}
                placeholder="Find in result..."
                containerClassName="w-40"
                className="text-xs"
                aria-label="Find in result"
              />
              <span className="text-sm text-muted font-mono">Execution: {formatQueryDuration(activeTab.executionTime)}</span>
              <Tooltip label="Export result">
                <button
                  onClick={() => setIsExportOpen(true)}
                  disabled={activeTab.rows.length === 0}
                  className="p-1 text-muted hover:text-primary hover:bg-bg-secondary rounded-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Export result"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
              <Tooltip label="Refresh results (re-run this tab's query)">
                <button
                  onClick={refreshResults}
                  disabled={isExecuting}
                  className="p-1 text-muted hover:text-primary hover:bg-bg-secondary rounded-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Refresh results"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isExecuting ? 'animate-spin' : ''}`} />
                </button>
              </Tooltip>
            </div>
          </div>
          {!editableMeta && !editability.editable && (
            <p className="mb-2 shrink-0 text-xs text-muted">Read-only: {describeReason(editability.reason)}{editability.detail ? ` (${editability.detail})` : ''}.</p>
          )}
          {activeTab.rows.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted">
              Query executed successfully. No rows returned.
            </div>
          ) : (
            <QueryResultGrid
              columns={activeTab.columns}
              data={activeTab.rows}
              columnTypes={activeTab.columnTypes}
              layoutKey={activeTab.sql}
              fillParent
              fitColumns
              searchQuery={resultSearchQuery}
              schema={editableMeta?.schema}
              table={editableMeta?.table}
              primaryKeys={editableMeta?.basePrimaryKeys}
              pksFromRow={editableMeta ? pksFromRow : undefined}
              columnToSource={editableMeta?.columnToSource}
              columnSchema={editableMeta ? sourceColumnInfo : undefined}
              onCellUpdate={editableMeta ? handleQueryCellUpdate : undefined}
              onRowDelete={editableMeta ? handleQueryRowDelete : undefined}
              readOnlyColumns={editableMeta?.readOnlyResultColumns}
              foreignKeys={resultForeignKeys}
              onForeignKeyClick={onForeignKeyClick}
            />
          )}
        </div>
      )}

      {!activeTab && resultTabs.length === 0 && !isExecuting && !error && (
        <div className="text-center py-6 text-sm text-muted">
          Run a query to see results here.
        </div>
      )}

      </section>
      </div>
      } />

      {pendingQueryConfirm && (
        <QueryExecutionConfirmation
          isOpen={!!pendingQueryConfirm}
          reason={pendingQueryConfirm.reason}
          sql={pendingQueryConfirm.sql}
          statement={pendingQueryConfirm.statement}
          kind={pendingQueryConfirm.kind}
          isBulkWrite={pendingQueryConfirm.isBulkWrite}
          requiresTypedConfirmation={pendingQueryConfirm.requiresTypedConfirmation}
          onConfirm={handleConfirmQueryExecution}
          onCancel={() => setPendingQueryConfirm(null)}
          isLoading={isExecuting}
        />
      )}

      <SaveQueryDialog
        isOpen={isSaveQueryOpen}
        onClose={() => setIsSaveQueryOpen(false)}
        onSave={(name, tags) => {
          saveQuery(name, pendingSaveQuery, tags);
          addToast(`Saved "${name}"`, 'success');
        }}
        query={pendingSaveQuery}
      />

      {activeTab && (
        <ExportModal
          isOpen={isExportOpen}
          onClose={() => setIsExportOpen(false)}
          source={{ kind: 'query', databaseType }}
          currentColumns={activeTab.columns}
          currentRows={activeTab.rows}
        />
      )}
    </div>
  );
};

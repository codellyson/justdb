
import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import {
  PostgreSQL,
  MySQL,
  SQLite,
  schemaCompletionSource,
} from '@codemirror/lang-sql';
import { LanguageSupport, syntaxTree } from '@codemirror/language';
import { keymap, EditorView, tooltips } from '@codemirror/view';
import {
  acceptCompletion,
  completeFromList,
  ifNotIn,
  type CompletionContext,
  type CompletionSource,
} from '@codemirror/autocomplete';
import { useTheme } from '../contexts/theme-context';
import { useConnection } from '../contexts/connection-context';
import { getEditorLineNumbers, EDITOR_SETTINGS_EVENT } from '@/lib/app-settings';
import {
  createBrutalistTheme,
  createBrutalistHighlight,
} from '@/lib/codemirror-brutalist-theme';

import { statementHover } from '@/lib/sql-hover';

type SQLSchemaSpec = { [name: string]: SQLSchemaSpec | readonly string[] };

// True when the cursor sits inside an identifier whose preceding
// non-whitespace token is `.` — i.e. the user is typing the member side
// of `table.column` or `alias.column`. lang-sql's built-in keyword
// completion only checks whether the current node IS the dot itself, so
// it still dumps the entire SQL keyword list right after `e.u`. We use
// this to suppress that noise so only actual columns appear.
function isAfterDot(ctx: CompletionContext): boolean {
  const node = syntaxTree(ctx.state).resolveInner(ctx.pos, -1);
  if (node.name !== 'Identifier' && node.name !== 'QuotedIdentifier') return false;
  const doc = ctx.state.doc;
  let i = node.from - 1;
  while (i >= 0) {
    const ch = doc.sliceString(i, i + 1);
    if (ch === '.') return true;
    if (!/\s/.test(ch)) return false;
    i--;
  }
  return false;
}

// Curated keyword list. lang-sql's default PostgreSQL dialect ships ~400
// words, many of them obscure (e.g. user_defined_type_catalog,
// pg_exception_context). For an interactive SQL editor those drown out
// what you actually want — column names. This list covers the 95% you
// use when writing day-to-day SQL.
const COMMON_KEYWORDS: ReadonlyArray<string> = [
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'ON', 'USING', 'AS',
  'GROUP', 'BY', 'ORDER', 'ASC', 'DESC', 'NULLS', 'FIRST', 'LAST', 'HAVING', 'LIMIT', 'OFFSET',
  'DISTINCT', 'UNION', 'INTERSECT', 'EXCEPT', 'ALL',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'RETURNING', 'WITH', 'RECURSIVE',
  'CREATE', 'DROP', 'ALTER', 'TABLE', 'INDEX', 'VIEW', 'SCHEMA', 'TRUNCATE', 'IF', 'EXISTS',
  'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'LIKE', 'ILIKE', 'BETWEEN',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'CAST', 'NULLIF',
  'NOW', 'CURRENT_TIMESTAMP', 'CURRENT_DATE',
  'TRUE', 'FALSE',
];

function curatedKeywordSource(): CompletionSource {
  const list = COMMON_KEYWORDS.map((label) => ({ label, type: 'keyword', boost: -1 }));
  // ifNotIn keeps the keyword list out of strings, comments, quoted
  // identifiers, and member-access positions (right side of a `.`).
  // isAfterDot already handles the identifier-after-dot case the parser
  // itself can't see; ifNotIn catches the dot-token case.
  const base = ifNotIn(
    ['QuotedIdentifier', 'String', 'LineComment', 'BlockComment', '.'],
    completeFromList(list),
  );
  return (ctx) => (isAfterDot(ctx) ? null : base(ctx));
}

// Keywords that open a position where a table name is expected. We
// include INTO and UPDATE so DML targets also flip the gate, even though
// query editing is the primary use case.
const TABLE_POSITION_STARTERS = new Set(['from', 'join', 'into', 'update']);
// Keywords that close a FROM/JOIN context. ON is in here because join
// conditions are column space, not table space.
const TABLE_POSITION_ENDERS = new Set([
  'where', 'group', 'having', 'order', 'union', 'intersect', 'except',
  'limit', 'offset', 'fetch', 'for', 'returning', 'on', 'set', 'values',
]);

// True when the cursor sits in a place where bare identifiers should
// resolve to table names (i.e. right after FROM/JOIN/INTO/UPDATE and
// before any closer). Used to decide whether to run the schema
// completion source for bare identifiers — without this, typing in
// WHERE/SELECT positions floods the menu with every table in the DB.
function isInTablePosition(ctx: CompletionContext): boolean {
  const doc = ctx.state.doc;
  let node = syntaxTree(ctx.state).resolveInner(ctx.pos, -1);
  while (node.parent && node.name !== 'Statement') node = node.parent;
  if (node.name !== 'Statement') return false;
  let inTablePos = false;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.from >= ctx.pos) break;
    if (child.name !== 'Keyword') continue;
    const kw = doc.sliceString(child.from, child.to).toLowerCase();
    if (TABLE_POSITION_STARTERS.has(kw)) inTablePos = true;
    else if (TABLE_POSITION_ENDERS.has(kw)) inTablePos = false;
  }
  return inTablePos;
}

// Walk the current Statement's FROM/JOIN clauses and collect the tables
// that are in scope. Returned names match what the user wrote: quoted
// identifiers are unwrapped (so `"Educators"` → `Educators`) since the
// schema map keys are the raw table names.
function collectFromTables(ctx: CompletionContext): string[] {
  const FROM_ENDERS = TABLE_POSITION_ENDERS;
  const FROM_STARTERS = TABLE_POSITION_STARTERS;

  const doc = ctx.state.doc;
  let node = syntaxTree(ctx.state).resolveInner(ctx.pos, -1);
  while (node.parent && node.name !== 'Statement') node = node.parent;
  if (node.name !== 'Statement') return [];

  const idText = (n: { name: string; from: number; to: number }): string => {
    const raw = doc.sliceString(n.from, n.to);
    if (n.name === 'QuotedIdentifier' && raw.length >= 2) {
      const q = raw[0];
      const inner = raw.slice(1, -1);
      // Postgres doubles the quote char to escape it inside quoted ids.
      return q === '"' ? inner.replace(/""/g, '"') : inner;
    }
    return raw;
  };

  // `ON` opens a join condition where identifiers are columns, not
  // tables. We pause table-capture until the next FROM-starter (a JOIN)
  // or a FROM-ender (WHERE/GROUP/...) brings us back into the FROM
  // clause proper.
  const tables: string[] = [];
  const seen = new Set<string>();
  let inFromClause = false;
  let inOnClause = false;
  let pendingTable: string | null = null;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'Keyword') {
      const kw = doc.sliceString(child.from, child.to).toLowerCase();
      if (FROM_STARTERS.has(kw)) {
        inFromClause = true;
        inOnClause = false;
        pendingTable = null;
        continue;
      }
      if (inFromClause && FROM_ENDERS.has(kw)) break;
      if (kw === 'on') {
        inOnClause = true;
        pendingTable = null;
        continue;
      }
      // Alias keyword "AS" is just a separator; any other keyword in the
      // FROM area closes off the current pending table.
      if (kw === 'as') continue;
      if (inFromClause) pendingTable = null;
      continue;
    }
    if (!inFromClause || inOnClause) continue;
    if (child.name === 'Identifier' || child.name === 'QuotedIdentifier') {
      const name = idText(child);
      if (pendingTable === null) {
        if (!seen.has(name)) {
          seen.add(name);
          tables.push(name);
        }
        pendingTable = name;
      } else {
        // Second identifier after a table name is the alias — ignore for
        // column lookup; lang-sql's schemaCompletionSource handles alias.
        pendingTable = null;
      }
      continue;
    }
    // Anything else (commas, operators, parens) ends the current table.
    pendingTable = null;
  }
  return tables;
}

// Surface columns of the FROM-clause tables for bare-identifier
// completion. Without this, typing `WHERE us` shows only keywords and
// top-level tables — never the columns of tables already in scope.
function fromContextColumnSource(
  schemaSpec: SQLSchemaSpec | undefined,
  defaultSchema: string | undefined,
): CompletionSource {
  return (ctx) => {
    if (!schemaSpec) return null;
    if (isAfterDot(ctx)) return null;
    const node = syntaxTree(ctx.state).resolveInner(ctx.pos, -1);
    const isIdent = node.name === 'Identifier' || node.name === 'QuotedIdentifier';
    if (!isIdent && !ctx.explicit) return null;
    const tables = collectFromTables(ctx);
    if (tables.length === 0) return null;

    const resolveCols = (table: string): readonly string[] | null => {
      const direct = schemaSpec[table];
      if (Array.isArray(direct)) return direct as readonly string[];
      if (defaultSchema) {
        const sub = schemaSpec[defaultSchema];
        if (sub && !Array.isArray(sub)) {
          const inSchema = (sub as SQLSchemaSpec)[table];
          if (Array.isArray(inSchema)) return inSchema as readonly string[];
        }
      }
      return null;
    };

    const seen = new Set<string>();
    const options: { label: string; type: string; boost: number }[] = [];
    for (const t of tables) {
      const cols = resolveCols(t);
      if (!cols) continue;
      for (const c of cols) {
        if (seen.has(c)) continue;
        seen.add(c);
        // Boost > 0 so columns land above the curated keywords (boost -1)
        // when both match the same prefix.
        options.push({ label: c, type: 'property', boost: 50 });
      }
    }
    if (options.length === 0) return null;
    return {
      from: isIdent ? node.from : ctx.pos,
      options,
      validFor: /^\w*$/,
    };
  };
}

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  schema?: SQLSchemaSpec;
  defaultSchema?: string;
  editorRef?: React.MutableRefObject<EditorView | null>;
  onSelectionChange?: (hasSelection: boolean) => void;
  onCursorChange?: (position: number) => void;
}

export const SqlEditor: React.FC<SqlEditorProps> = ({
  value,
  onChange,
  disabled = false,
  placeholder = 'SELECT * FROM users LIMIT 10;',
  schema: schemaSpec,
  defaultSchema,
  editorRef,
  onSelectionChange,
  onCursorChange,
}) => {
  const { mode } = useTheme();
  const { databaseType } = useConnection();
  const isDark = mode === 'dark';

  // Line-number visibility is a Settings pref; re-read it live when changed.
  const [lineNumbers, setLineNumbers] = useState(getEditorLineNumbers());
  useEffect(() => {
    const onChange = () => setLineNumbers(getEditorLineNumbers());
    window.addEventListener(EDITOR_SETTINGS_EVENT, onChange);
    return () => window.removeEventListener(EDITOR_SETTINGS_EVENT, onChange);
  }, []);

  const basicSetup = useMemo(
    () => ({
      lineNumbers,
      // No active-line / gutter background highlight — keeps the editor clean
      // on focus (the cursor is enough of an indicator).
      highlightActiveLineGutter: false,
      highlightActiveLine: false,
      bracketMatching: true,
      closeBrackets: true,
      autocompletion: true,
      foldGutter: false,
      indentOnInput: true,
    }),
    [lineNumbers],
  );

  // Hold the selection callback in a ref so extensions stay stable across renders.
  const onCursorChangeRef = useRef(onCursorChange);
  useEffect(() => { onCursorChangeRef.current = onCursorChange; }, [onCursorChange]);
  const onSelectionChangeRef = useRef(onSelectionChange);
  useEffect(() => { onSelectionChangeRef.current = onSelectionChange; }, [onSelectionChange]);

  const handleCreateEditor = useCallback((view: EditorView) => {
    if (editorRef) {
      editorRef.current = view;
    }
  }, [editorRef]);

  const extensions = useMemo(() => {
    const sqlDialect = databaseType === 'mysql' ? MySQL : databaseType === 'sqlite' ? SQLite : PostgreSQL;
    // Build the SQL language support manually so we can swap in our own
    // completion sources: a curated keyword list (replaces the dialect's
    // bloated one) and a FROM-clause column source (so bare-identifier
    // completion surfaces columns that are actually in scope).
    const langData = sqlDialect.language.data;
    const completion: any[] = [
      langData.of({ autocomplete: curatedKeywordSource() }),
    ];
    if (schemaSpec) {
      const rawSchemaSource = schemaCompletionSource({
        dialect: sqlDialect,
        schema: schemaSpec as any,
        defaultSchema,
      });
      // Gate the schema source so it only contributes for dotted access
      // (foo.col, schema.table) and for bare identifiers in true table
      // positions (FROM/JOIN/INTO/UPDATE). Otherwise it'd dump every
      // table name into the menu while the user is typing a column.
      const gatedSchemaSource: CompletionSource = (ctx) => {
        if (isAfterDot(ctx) || isInTablePosition(ctx)) return rawSchemaSource(ctx);
        return null;
      };
      completion.push(
        langData.of({
          autocomplete: fromContextColumnSource(schemaSpec, defaultSchema),
        }),
        langData.of({ autocomplete: gatedSchemaSource }),
      );
    }
    const exts = [
      new LanguageSupport(sqlDialect.language, completion),
      createBrutalistTheme(isDark),
      createBrutalistHighlight(),
      statementHover,
      tooltips({ parent: document.body }),
      // Accept completion with Tab
      keymap.of([
        { key: 'Tab', run: acceptCompletion },
      ]),
    ];

    exts.push(
      EditorView.updateListener.of((update) => {
        if (update.selectionSet || update.docChanged) {
          onCursorChangeRef.current?.(update.state.selection.main.head);
        }
        if (update.selectionSet && onSelectionChangeRef.current) {
          const { from, to } = update.state.selection.main;
          onSelectionChangeRef.current(from !== to);
        }
      })
    );

    return exts;
  }, [isDark, databaseType, schemaSpec, defaultSchema]);

  return (
    <div className="h-full overflow-hidden">
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        placeholder={placeholder}
        editable={!disabled}
        height="100%"
        theme="none"
        style={{ height: '100%' }}
        onCreateEditor={handleCreateEditor}
        basicSetup={basicSetup}
      />
    </div>
  );
};

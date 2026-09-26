import {
  type Dialect,
  escapeIdentifier,
  placeholder,
  validateIdentifier,
} from "./mutation";

export type FilterOperator =
  | "eq"
  | "neq"
  | "contains"
  | "starts_with"
  | "is_null"
  | "is_not_null"
  | "between"
  | "in";

export interface Filter {
  column: string;
  operator: FilterOperator;
  /** single value — used by eq, neq, contains, starts_with */
  value?: any;
  /** [low, high] for between; list of values for in */
  values?: any[];
}

/**
 * Render a list of filters into a SQL WHERE clause and a parameter array.
 * `paramOffset` lets the caller chain multiple parameter groups (e.g. when
 * the same query already has bind params from sorting / pagination).
 *
 * Returns an empty string and empty params when filters is empty.
 */
export function buildFilterSql(
  filters: Filter[],
  dialect: Dialect,
  paramOffset: number = 0
): { whereClause: string; params: any[] } {
  if (!filters || filters.length === 0) {
    return { whereClause: "", params: [] };
  }

  const esc = (n: string) => escapeIdentifier(n, dialect);
  const params: any[] = [];
  const clauses: string[] = [];
  let paramIndex = paramOffset + 1;

  const next = () => placeholder(paramIndex++, dialect);

  for (const f of filters) {
    validateIdentifier(f.column);
    const col = esc(f.column);
    switch (f.operator) {
      case "eq":
        clauses.push(`${col} = ${next()}`);
        params.push(f.value);
        break;
      case "neq":
        clauses.push(`${col} <> ${next()}`);
        params.push(f.value);
        break;
      case "contains":
        clauses.push(`${col} ILIKE ${next()}`);
        params.push(`%${escapeLike(f.value)}%`);
        break;
      case "starts_with":
        clauses.push(`${col} ILIKE ${next()}`);
        params.push(`${escapeLike(f.value)}%`);
        break;
      case "is_null":
        clauses.push(`${col} IS NULL`);
        break;
      case "is_not_null":
        clauses.push(`${col} IS NOT NULL`);
        break;
      case "between": {
        const vs = f.values ?? [];
        if (vs.length !== 2) throw new Error("between requires two values");
        clauses.push(`${col} BETWEEN ${next()} AND ${next()}`);
        params.push(vs[0], vs[1]);
        break;
      }
      case "in": {
        const vs = f.values ?? [];
        if (vs.length === 0) throw new Error("in requires at least one value");
        const ph = vs.map(() => next()).join(", ");
        clauses.push(`${col} IN (${ph})`);
        params.push(...vs);
        break;
      }
      default:
        throw new Error(`Unknown filter operator: ${(f as Filter).operator}`);
    }
  }

  // MySQL and SQLite don't have ILIKE — substitute LIKE for those.
  let whereClause = `WHERE ${clauses.join(" AND ")}`;
  if (dialect === "mysql" || dialect === "sqlite") {
    whereClause = whereClause.replace(/ ILIKE /g, " LIKE ");
  }
  return { whereClause, params };
}

function escapeLike(value: any): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Render filters as a human-readable WHERE-clause string for transparency
 * in the UI. Values are quoted and escaped so the user can copy-paste it.
 */
export function describeFilters(filters: Filter[]): string {
  if (!filters || filters.length === 0) return "";
  const parts = filters.map((f) => {
    const col = `"${f.column.replace(/"/g, '""')}"`;
    const v = (x: any) =>
      x === null || x === undefined
        ? "NULL"
        : typeof x === "boolean"
          ? (x ? "TRUE" : "FALSE")
        : typeof x === "number"
          ? String(x)
          : `'${String(x).replace(/'/g, "''")}'`;
    switch (f.operator) {
      case "eq":
        return `${col} = ${v(f.value)}`;
      case "neq":
        return `${col} <> ${v(f.value)}`;
      case "contains":
        return `${col} contains ${v(f.value)}`;
      case "starts_with":
        return `${col} starts with ${v(f.value)}`;
      case "is_null":
        return `${col} IS NULL`;
      case "is_not_null":
        return `${col} IS NOT NULL`;
      case "between": {
        const vs = f.values ?? [];
        return `${col} BETWEEN ${v(vs[0])} AND ${v(vs[1])}`;
      }
      case "in": {
        const vs = (f.values ?? []).map(v).join(", ");
        return `${col} IN (${vs})`;
      }
      default:
        return "";
    }
  });
  return `WHERE ${parts.join(" AND ")}`;
}

import { classifyQuery } from './query-classifier';
const explanations: Record<string, string> = {
  SELECT: 'Reads rows or computes values. The selected columns determine what appears in the result.',
  WITH: 'Defines temporary named results for use within this statement.',
  INSERT: 'Adds rows to a table.',
  UPDATE: 'Changes values in existing rows. A WHERE clause limits which rows are updated.',
  DELETE: 'Removes rows from a table. A WHERE clause limits which rows are deleted.',
  CREATE: 'Creates a database object, such as a table, view, or index.',
  ALTER: 'Changes the definition of an existing database object.',
  DROP: 'Removes a database object. Dropping a table also removes its data.',
  TRUNCATE: 'Removes all rows from a table.',
  BEGIN: 'Starts a transaction so related changes can be committed or rolled back together.',
  START: 'Starts a transaction.',
  COMMIT: 'Commits the current transaction.',
  END: 'Ends and commits the current transaction.',
  ROLLBACK: 'Undoes changes in a transaction, or returns to a named savepoint.',
  SAVEPOINT: 'Creates a point within a transaction that you can roll back to.',
  RELEASE: 'Releases a named savepoint.',
  EXPLAIN: 'Shows how the database plans a statement. ANALYZE also executes the statement to measure it.',
  PRAGMA: 'Inspects or configures SQLite database behavior.',
  SHOW: 'Displays database configuration or metadata.',
  DESCRIBE: 'Displays information about a database object.',
  MERGE: 'Inserts, updates, or deletes rows according to matching conditions.',
  REPLACE: 'Replaces conflicting rows or inserts new rows, depending on the database dialect.',
};

const clauses: Record<string, string> = {
  FROM: 'Specifies the table, view, or subquery supplying rows to this query.',
  WHERE: 'Keeps only rows for which this condition is true.',
  LIMIT: 'Caps the number of rows returned. Use ORDER BY when you need a predictable subset.',
  OFFSET: 'Skips this many rows before returning results.',
  AS: 'Assigns an alias to a column, expression, table, or named query.',
  DISTINCT: 'Removes duplicate rows from the selected results.',
  JOIN: 'Combines rows from another source, usually using an ON or USING condition.',
  LEFT: 'In a LEFT JOIN, keeps every left-side row and fills unmatched right-side columns with NULL.',
  RIGHT: 'In a RIGHT JOIN, keeps every right-side row and fills unmatched left-side columns with NULL.',
  INNER: 'In an INNER JOIN, returns only rows that match the join condition.',
  FULL: 'In a FULL JOIN, keeps matched rows and unmatched rows from both sources.',
  CROSS: 'In a CROSS JOIN, pairs every row from one source with every row from the other.',
  ON: 'Specifies the matching condition for a join, or introduces a dialect-specific conflict clause.',
  USING: 'Names shared columns used for matching in a join, or a source in dialect-specific statements.',
  GROUP: 'GROUP BY collects rows with matching values so aggregate functions can summarize each group.',
  ORDER: 'ORDER BY sorts the result using the listed expressions.',
  BY: 'Introduces the expressions used by GROUP BY, ORDER BY, or PARTITION BY.',
  HAVING: 'Filters groups after aggregation, unlike WHERE which filters input rows.',
  ASC: 'Sorts values in ascending order.',
  DESC: 'Sorts values in descending order; at the start of a statement, may abbreviate DESCRIBE.',
  AND: 'Requires both conditions to be true.',
  OR: 'Requires at least one condition to be true.',
  NOT: 'Negates a condition.',
  NULL: 'Represents a missing or unknown value. Test with IS NULL or IS NOT NULL.',
  IS: 'Tests values, commonly with IS NULL or IS NOT NULL.',
  IN: 'Tests whether a value matches a value in a list or subquery.',
  EXISTS: 'Tests whether a subquery returns at least one row.',
  LIKE: 'Matches a text pattern: % matches any sequence and _ matches one character.',
  BETWEEN: 'Tests whether a value falls within an inclusive range.',
  UNION: 'Combines compatible query results, removing duplicates unless ALL is specified.',
  ALL: 'In UNION ALL, preserves duplicates; with a comparison, applies it to all subquery values.',
  SET: 'Assigns values in an UPDATE, or changes a database setting in a SET statement.',
  INTO: 'Specifies a destination, such as the target table of an INSERT.',
  VALUES: 'Supplies literal or computed rows, commonly for an INSERT.',
  RETURNING: 'Returns values from rows affected by a write statement.',
  CASE: 'Chooses a result by evaluating WHEN conditions.',
  WHEN: 'Specifies a condition in a CASE expression or other conditional SQL clause.',
  THEN: 'Specifies the result or action when a condition is true.',
  ELSE: 'Specifies the fallback when no preceding condition matches.',
  OVER: 'Applies a function across a window of rows without collapsing those rows.',
  PARTITION: 'PARTITION BY divides rows into independent windows for a window function.',
};

const functions: Record<string, string> = {
  COUNT: 'Counts rows with COUNT(*), or non-NULL values with COUNT(expression).',
  SUM: 'Adds the non-NULL values in a group or window.',
  AVG: 'Calculates the average of non-NULL values in a group or window.',
  MIN: 'Returns the smallest non-NULL value.',
  MAX: 'Returns the largest non-NULL value.',
  COALESCE: 'Returns the first argument that is not NULL.',
  ROUND: 'Rounds a number to the requested precision.',
  LOWER: 'Converts text to lowercase.',
  UPPER: 'Converts text to uppercase.',
  LENGTH: 'Returns the length of a value; units and supported types depend on the database.',
  ROW_NUMBER: 'Numbers rows within each window partition according to its ordering.',
  RANK: 'Ranks rows within a window, leaving gaps after ties.',
};

export function explainSqlToken(token: string, isFunction = false) {
  const title = token.toUpperCase();
  const description = isFunction ? functions[title] : clauses[title] ?? explanations[title];
  return description ? { title, description } : null;
}

/** Local syntax guidance, never an execution plan or a promise of side-effect safety. */
export function explainStatement(sql: string): { title: string; description: string } | null {
  const c = classifyQuery(sql);
  if (!c.statement) return null;
  return {
    title: c.statement,
    description: c.reason && c.kind !== 'unknown' ? c.reason :
      explanations[c.statement] ?? 'No local explanation is available for this statement. Check the documentation for your database dialect.',
  };
}

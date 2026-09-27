import { describe, expect, it } from 'vitest';
import { parseFilterExpression } from './filter-expression';
import { describeFilters, type Filter } from './filters';
const columns = ['host', 'place', 'count', 'active'];
describe('toolbar WHERE filters', () => {
  it('accepts quoted and unquoted email columns and preserves plus addressing', () => {
    for (const name of ['email', '"email"']) {
      expect(parseFilterExpression(`${name}='name+1@example.com'`, ['email'])).toEqual([
        { column: 'email', operator: 'eq', value: 'name+1@example.com' },
      ]);
    }
  });
  it('explains curly delimiters and single-quoted column mistakes', () => {
    expect(() => parseFilterExpression("‘email'='name+1@example.com'", ['email'])).toThrow('curly quotes');
    expect(() => parseFilterExpression("'email'='name+1@example.com'", ['email'])).toThrow('Single quotes are for text values');
    expect(() => parseFilterExpression("email='unfinished", ['email'])).toThrow('Close the text value');
  });
  it('preserves typographic apostrophes inside correctly quoted values', () => {
    expect(parseFilterExpression("host = 'O’Brien'", columns)[0].value).toBe('O’Brien');
  });
  it('parses the example into bound server filters', () => {
    expect(parseFilterExpression("host = 'Mac' AND place IS NOT NULL", columns)).toEqual([
      { column: 'host', operator: 'eq', value: 'Mac' },
      { column: 'place', operator: 'is_not_null' },
    ]);
  });
  it('keeps AND and escaped quotes inside string values', () => {
    expect(parseFilterExpression("WHERE host = 'O''Brien AND Mac'", columns)[0].value).toBe("O'Brien AND Mac");
  });
  it('distinguishes BETWEEN AND from the next condition', () => {
    expect(parseFilterExpression("count BETWEEN 1 AND 10 AND host IN ('Mac', 'Linux')", columns)).toEqual([
      { column: 'count', operator: 'between', values: [1, 10] },
      { column: 'host', operator: 'in', values: ['Mac', 'Linux'] },
    ]);
  });
  it('clears on empty input and preserves value types on round trip', () => {
    expect(parseFilterExpression('  ', columns)).toEqual([]);
    const filters: Filter[] = [{ column: 'active', operator: 'eq', value: false }, { column: 'place', operator: 'contains', value: 'a AND b' }];
    expect(parseFilterExpression(describeFilters(filters), columns)).toEqual(filters);
  });
  it.each(["host = 'Mac' AND", "host = 'Mac' OR place IS NULL", "host = NULL", "host = 'Mac'; DELETE FROM claim", "unknown = 1", "count = 9007199254740993", "host = 'Mac' AND host != 'Linux'", 'WHERE'])('rejects invalid or unsupported expressions: %s', expression => {
    expect(() => parseFilterExpression(expression, columns)).toThrow();
  });
});

import type { Filter } from './filters';

type Token = { kind: 'word' | 'identifier' | 'string' | 'number' | 'symbol'; value: string };

/** Parse the WHERE shorthand into the same bound filters used by the grid. */
export function parseFilterExpression(expression: string, columns: string[]): Filter[] {
  const tokens: Token[] = [];
  let rest = expression.trim();
  while (rest) {
    const match = /^(?:\s+|('(?:''|[^'])*')|("(?:""|[^"])*")|(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_$]*)|(<>|!=|=|\(|\)|,))/i.exec(rest);
    if (!match) throw new Error(`Unexpected syntax near “${rest.slice(0, 24)}”. Use AND to combine filters.`);
    if (match[1]) tokens.push({ kind: 'string', value: match[1].slice(1, -1).replace(/''/g, "'") });
    else if (match[2]) tokens.push({ kind: 'identifier', value: match[2].slice(1, -1).replace(/""/g, '"') });
    else if (match[3]) tokens.push({ kind: 'number', value: match[3] });
    else if (match[4]) tokens.push({ kind: 'word', value: match[4] });
    else if (match[5]) tokens.push({ kind: 'symbol', value: match[5] });
    rest = rest.slice(match[0].length);
  }
  let position = 0;
  const eat = (value: string) => {
    const token = tokens[position];
    if (token && (token.kind === 'word' || token.kind === 'symbol') && token.value.toUpperCase() === value) {
      position++;
      return true;
    }
    return false;
  };
  const expect = (value: string) => { if (!eat(value)) throw new Error(`Expected ${value}.`); };
  const literal = (): string | number | boolean | null => {
    const token = tokens[position++];
    if (!token) throw new Error('Enter a value after the operator.');
    if (token.kind === 'string') return token.value;
    if (token.kind === 'number') {
      const value = Number(token.value);
      if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Error('Quote large numbers to preserve their precision.');
      return value;
    }
    if (token.kind === 'word') {
      if (token.value.toUpperCase() === 'NULL') return null;
      if (token.value.toUpperCase() === 'TRUE') return true;
      if (token.value.toUpperCase() === 'FALSE') return false;
    }
    throw new Error('Put text values in single quotes, for example host = \'Mac\'.');
  };
  eat('WHERE');
  const filters: Filter[] = [];
  if (position === tokens.length) {
    if (tokens.length) throw new Error('Enter a condition after WHERE.');
    return filters;
  }
  do {
    const token = tokens[position++];
    if (!token || !['word', 'identifier'].includes(token.kind)) throw new Error('Start each condition with a column name.');
    const column = columns.find(c => c === token.value) ?? (token.kind === 'word' ? columns.find(c => c.toLowerCase() === token.value.toLowerCase()) : undefined);
    if (!column) throw new Error(`Unknown column “${token.value}”.`);
    if (filters.some(f => f.column === column)) throw new Error(`Use BETWEEN for a range on “${column}”. Each column can have one filter.`);
    if (eat('=')) {
      const value = literal();
      if (value === null) throw new Error('Use IS NULL to match null values.');
      filters.push({ column, operator: 'eq', value });
    } else if (eat('<>') || eat('!=')) {
      const value = literal();
      if (value === null) throw new Error('Use IS NOT NULL to exclude null values.');
      filters.push({ column, operator: 'neq', value });
    } else if (eat('IS')) {
      const not = eat('NOT'); expect('NULL');
      filters.push({ column, operator: not ? 'is_not_null' : 'is_null' });
    } else if (eat('BETWEEN')) {
      const low = literal(); expect('AND');
      filters.push({ column, operator: 'between', values: [low, literal()] });
    } else if (eat('IN')) {
      expect('('); const values = [literal()];
      while (eat(',')) values.push(literal());
      expect(')'); filters.push({ column, operator: 'in', values });
    } else if (eat('CONTAINS')) {
      filters.push({ column, operator: 'contains', value: literal() });
    } else if (eat('STARTS')) {
      expect('WITH'); filters.push({ column, operator: 'starts_with', value: literal() });
    } else {
      throw new Error('Use =, !=, IS NULL, IS NOT NULL, IN, BETWEEN, CONTAINS, or STARTS WITH.');
    }
    if (position === tokens.length) break;
    expect('AND');
    if (position === tokens.length) throw new Error('Add a condition after AND.');
  } while (position < tokens.length);
  return filters;
}

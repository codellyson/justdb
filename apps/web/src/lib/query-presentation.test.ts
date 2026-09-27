import { describe, expect, it } from 'vitest';
import { fitQueryColumns, formatQueryDuration, queryColumnTypes } from './query-presentation';

describe('query presentation', () => {
  it('only interprets PostgreSQL type identifiers for PostgreSQL', () => {
    const fields = [{ name: 'id', dataTypeID: 23, source: null }];
    expect(queryColumnTypes(fields, 'postgresql')).toEqual({ id: 'integer' });
    expect(queryColumnTypes(fields, 'sqlite')).toEqual({});
    expect(queryColumnTypes(undefined, 'postgresql')).toEqual({});
  });

  it('distinguishes sub-millisecond durations from missing timings', () => {
    expect(formatQueryDuration(0)).toBe('<1 ms');
    expect(formatQueryDuration(0.6)).toBe('<1 ms');
    expect(formatQueryDuration(12)).toBe('12 ms');
    expect(formatQueryDuration(NaN)).toBe('—');
  });

  it('distributes spare space equally regardless of value type', () => {
    expect(fitQueryColumns(['id', 'title'], [{ id: 1, title: 'Motion verification' }], {}, 1000))
      .toEqual({ id: 500, title: 500 });
  });

  it('preserves explicit user widths even when they overflow', () => {
    expect(fitQueryColumns(['id', 'title'], [], { id: 150, title: 500 }, 300))
      .toEqual({ id: 150, title: 500 });
  });

  it('handles empty and null-only results', () => {
    expect(fitQueryColumns(['title'], [{ title: null }], {}, 600)).toEqual({ title: 600 });
    expect(fitQueryColumns([], [], {}, 600)).toEqual({});
  });
});

import { expect, it } from 'vitest';
import { localPathLabel } from './local-path-label';
it('keeps enough parent folders to distinguish matching filenames', () => {
  const paths = ['/projects/api/data/local.db', '/projects/web/data/local.db'];
  expect(paths.map(path => localPathLabel(path, paths))).toEqual(['…/api/data/local.db', '…/web/data/local.db']);
});
it('makes generated D1 filenames compact without losing project identity', () => {
  const filename = `${'a'.repeat(64)}.sqlite`;
  const paths = ['api', 'web'].map(project => `/projects/${project}/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/${filename}`);
  expect(paths.map(path => localPathLabel(path, paths))).toEqual(['…/api/aaaaaaaa…aaaaaaaa.sqlite', '…/web/aaaaaaaa…aaaaaaaa.sqlite']);
});
it('handles Windows separators and short paths', () => {
  expect(localPathLabel('C:\\data\\local.db', [])).toBe('…/data/local.db');
  expect(localPathLabel('local.db', [])).toBe('local.db');
});

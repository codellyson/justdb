/** Canonical origin — kept in sync with `site` in astro.config.mjs. */
export const SITE_URL = 'https://justdb.kreativekorna.com';
export const SITE_NAME = 'JustDB';
export const ORG_NAME = 'KreativeKorna Concepts';

export const REPO = 'codellyson/justdb';
export const REPO_URL = `https://github.com/${REPO}`;
export const REPO_ORG_URL = 'https://github.com/codellyson';
export const RELEASES_URL = `${REPO_URL}/releases`;
export const ISSUES_URL = `${REPO_URL}/issues`;
export const DOCS_URL = `${REPO_URL}#readme`;
export const ORG_URL = 'https://kreativekorna.com';

// The "Open JustDB" CTA points at the `justdb://` scheme registered by the
// Tauri build (see src-tauri/tauri.conf.json → plugins.deep-link), so the
// visible action matches the intent. index.astro's client script falls back to
// a download when nothing handles it.
export const LAUNCH_URL = 'justdb://open';

/**
 * Databases the Rust backend can actually open. `DbType` in
 * src-tauri/src/postgres.rs has exactly two variants — Postgresql and Sqlite —
 * and the MySQL chip in the connection form is deliberately hidden until a
 * MySQL driver lands. Anything not shipped is marked `planned` so the page
 * never claims support the app doesn't have.
 */
export const DATABASES = [
  { name: 'PostgreSQL', note: 'Local, Docker, or hosted', tint: '54 108 158', planned: false },
  { name: 'SQLite', note: 'Any local .db file', tint: '10 121 175', planned: false },
  { name: 'Turso / libSQL', note: 'Remote, via auth token', tint: '76 191 143', planned: false },
  { name: 'MySQL', note: 'Planned', tint: '124 114 102', planned: true },
  { name: 'MariaDB', note: 'Planned', tint: '124 114 102', planned: true },
] as const;

/** What the release matrix in .github/workflows/release.yml actually builds. */
export const PLATFORMS = [
  { name: 'macOS', note: 'Universal — Apple silicon + Intel' },
  { name: 'Windows', note: 'x64 installer (.exe) or .msi' },
] as const;

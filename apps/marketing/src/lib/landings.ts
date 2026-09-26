/**
 * Long-tail landing pages (SEO pillar 1). Each page owns one high-intent,
 * lower-competition phrase — "fast SQLite viewer for macOS", "minimalist
 * PostgreSQL GUI" — instead of fighting head terms like "best database client".
 *
 * Content stays honest and specific to JustDB's actual capabilities; the mock
 * chooses which live product panel anchors the hero.
 */
export interface Landing {
  slug: string;
  /** Primary keyword the page targets. */
  keyword: string;
  title: string;
  description: string;
  eyebrow: string;
  h1: string;
  lead: string;
  /** Which live mock panel to show in the hero frame. */
  mock: 'browse' | 'query' | 'edit';
  /** Three value propositions. */
  points: { title: string; body: string }[];
  /** Concrete capability bullets. */
  bullets: string[];
  faq: { q: string; a: string }[];
}

export const LANDINGS: Landing[] = [
  {
    slug: 'sqlite-viewer-macos',
    keyword: 'fast SQLite viewer for macOS',
    title: 'Fast SQLite Viewer for macOS — JustDB',
    description:
      'A fast, native SQLite viewer for macOS. Open any .db file, browse tables and rows, run SQL and edit records — free, no signup, Apple silicon and Intel.',
    eyebrow: 'SQLite on macOS',
    h1: 'A fast SQLite viewer for macOS.',
    lead: 'Double-click into any SQLite file and see it laid out plainly — tables, columns, indexes and rows. JustDB is a native macOS app (universal for Apple silicon and Intel) that opens quickly and keeps a light footprint, so poking at a .db file never means launching something heavy.',
    mock: 'browse',
    points: [
      { title: 'Open any .db file', body: 'Point JustDB at a SQLite, .db or .sqlite file on disk and it opens straight away — no server, no import step.' },
      { title: 'Native and quick', body: 'A real macOS app built on Rust and Tauri, universal for Apple silicon and Intel. It starts fast and stays out of the way.' },
      { title: 'View, query, edit', body: 'Browse rows, run SQL with completion and EXPLAIN, or change a cell inline — with a Review-SQL step before anything is written.' },
    ],
    bullets: [
      'Tables and views with live row counts',
      'Column types, nullability and defaults at a glance',
      'A real SQL editor with syntax highlighting and formatting',
      'Inline cell editing with staged, reviewable changes',
      'Export to CSV, JSON, SQL or Excel',
      'Everything local — the file never leaves your machine',
    ],
    faq: [
      { q: 'Is the SQLite viewer free?', a: 'Yes. JustDB is free with no account, no trial and no paid tier. Download it, open a .db file, and you are in.' },
      { q: 'Does it run natively on Apple silicon?', a: 'Yes. JustDB ships a universal macOS build, so it runs natively on both Apple silicon (M-series) and Intel Macs.' },
      { q: 'Can I edit SQLite data, not just view it?', a: 'Yes. Change a cell, add a row or delete one. Edits stage up first so you can read the exact SQL before it runs against the file.' },
      { q: 'Which SQLite file types can it open?', a: 'Any standard SQLite database file — .db, .sqlite or .sqlite3 — as well as remote libSQL/Turso databases over an authenticated URL.' },
    ],
  },
  {
    slug: 'postgresql-gui',
    keyword: 'minimalist PostgreSQL GUI',
    title: 'Minimalist PostgreSQL GUI — JustDB',
    description:
      'A minimalist PostgreSQL GUI for developers. Browse schemas, run SQL and edit rows in a fast native desktop app — local, Docker or hosted Postgres. Free, no signup.',
    eyebrow: 'PostgreSQL',
    h1: 'A minimalist PostgreSQL GUI.',
    lead: 'Paste a connection string and you are looking at your schema. JustDB is a small, native desktop GUI for PostgreSQL — local, in Docker, or hosted — that skips the dashboards and admin panels and gets you straight to tables, queries and rows.',
    mock: 'query',
    points: [
      { title: 'Connect in seconds', body: 'Any PostgreSQL you can reach — localhost, a Docker container, or a hosted server with TLS. Paste a URL and connect.' },
      { title: 'Just the essentials', body: 'No server dashboard, no role manager, no nine panels. Tables, a SQL editor and inline editing — the everyday loop.' },
      { title: 'Credentials stay yours', body: 'A direct connection from your machine. Passwords live in the OS keychain, never a cloud account.' },
    ],
    bullets: [
      'Browse tables, views, columns, indexes and foreign keys',
      'Follow a foreign key to the row it points at',
      'SQL editor with completion, formatting and EXPLAIN plans',
      'Inline row editing with a Review-SQL step and cascade preview',
      'Connect to local, Docker or hosted Postgres over TLS',
      'Import from CSV; export to CSV, JSON, SQL or Excel',
    ],
    faq: [
      { q: 'Is JustDB a full PostgreSQL admin tool?', a: 'No — and that is the point. JustDB focuses on the everyday developer loop: browsing schemas, running queries and editing rows. For deep server administration, a tool like pgAdmin is a better fit.' },
      { q: 'Can it connect to Postgres in Docker?', a: 'Yes. A container is just a host and a port — point JustDB at localhost:5432 (or whatever you published) like any other server.' },
      { q: 'Does it work with hosted Postgres?', a: 'Yes. Any PostgreSQL you can reach over the network, with TLS when the server requires it.' },
      { q: 'Is it free?', a: 'Yes. No account, no trial, no paid tier. It is a free native desktop app for macOS and Windows.' },
    ],
  },
  {
    slug: 'turso-libsql-client',
    keyword: 'Turso libSQL desktop client',
    title: 'Turso / libSQL Desktop Client — JustDB',
    description:
      'A native desktop client for Turso and libSQL. Connect over an authenticated libsql:// URL, browse tables, run SQL and edit rows — free, no signup, macOS and Windows.',
    eyebrow: 'Turso / libSQL',
    h1: 'A desktop client for Turso and libSQL.',
    lead: 'Connect to a remote Turso or libSQL database over an authenticated libsql:// URL and work with it like any local database — tables, SQL and inline edits. JustDB is a small native app for macOS and Windows, free with no signup.',
    mock: 'browse',
    points: [
      { title: 'Authenticated libsql://', body: 'Paste your Turso database URL and auth token; JustDB connects straight from your machine over the libSQL protocol.' },
      { title: 'The same familiar view', body: 'Turso databases open into the same panes as SQLite and PostgreSQL — tables, a SQL editor, and inline editing.' },
      { title: 'Native, not a web console', body: 'A real desktop window, not a browser tab. Your token lives in the OS keychain.' },
    ],
    bullets: [
      'Connect over an authenticated libsql:// URL',
      'Browse tables, views and rows with live counts',
      'Run SQL with completion, formatting and EXPLAIN',
      'Edit rows inline with a Review-SQL step',
      'Export to CSV, JSON, SQL or Excel',
      'Auth token stored in the OS keychain, not the cloud',
    ],
    faq: [
      { q: 'How does JustDB connect to Turso?', a: 'Over the libSQL protocol using your database’s libsql:// URL and an auth token. The token is stored in your OS keychain and the connection runs straight from your machine.' },
      { q: 'Does it work with self-hosted libSQL?', a: 'Yes. Any libSQL database reachable over a libsql:// URL with a valid auth token works the same way as a hosted Turso database.' },
      { q: 'Is it free?', a: 'Yes. JustDB is free with no account and no paid tier, on macOS and Windows.' },
    ],
  },
];

export const getLanding = (slug: string) => LANDINGS.find((l) => l.slug === slug);

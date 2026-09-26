/**
 * Data for the /compare/[slug] pages (SEO pillar 3 — "versus" search intent).
 *
 * House rule: every claim here is qualitative and checkable (architecture,
 * platform support, pricing model, database coverage) — no invented benchmark
 * numbers. Each entry also carries an honest `whenThem` section, because an
 * objective comparison ranks better and reads as trustworthy rather than a
 * sales sheet.
 */
export interface CompareRow {
  label: string;
  justdb: string;
  them: string;
  /** true → JustDB has the edge on this row (styled as a win). */
  win?: boolean;
}

export interface Comparison {
  slug: string;
  /** Competitor display name. */
  competitor: string;
  /** Primary keyword this page targets. */
  keyword: string;
  title: string;
  description: string;
  eyebrow: string;
  h1: string;
  lead: string;
  /** One-line summary of what the competitor is, stated fairly. */
  them: string;
  rows: CompareRow[];
  switchReasons: { title: string; body: string }[];
  /** Honest: cases where the competitor is the better tool. */
  whenThem: string[];
  faq: { q: string; a: string }[];
}

export const COMPARISONS: Comparison[] = [
  {
    slug: 'dbeaver',
    competitor: 'DBeaver',
    keyword: 'lightweight DBeaver alternative',
    title: 'JustDB vs DBeaver — a lightweight DBeaver alternative',
    description:
      'JustDB vs DBeaver, compared honestly. A native, minimal database client versus a full Java-based platform — startup, footprint, database support and price.',
    eyebrow: 'JustDB vs DBeaver',
    h1: 'A lightweight alternative to DBeaver.',
    lead: 'DBeaver is a powerful, do-everything database tool built on Java and Eclipse. That power comes with a JVM, a large install and a lot of UI. If you mostly browse tables, run SQL and edit a few rows in PostgreSQL or SQLite, JustDB gets you there with far less between you and your data.',
    them: 'DBeaver is a mature, cross-platform database client built on the Eclipse/Java stack, with a free Community Edition and a paid PRO tier. It supports 80-plus databases and ships deep tooling — ER diagrams, a visual query builder, data transfer and more.',
    rows: [
      { label: 'Architecture', justdb: 'Native desktop app (Rust + Tauri)', them: 'Java / Eclipse RCP, runs on a JVM' },
      { label: 'Startup & footprint', justdb: 'Small binary, quick cold start, low idle memory', them: 'Heavier install and memory use — a full JVM app', win: true },
      { label: 'Databases', justdb: 'PostgreSQL, SQLite, Turso/libSQL (MySQL planned)', them: '80+ databases over JDBC' },
      { label: 'Price', justdb: 'Free — no paid tier', them: 'Community Edition free; DBeaver PRO is a paid subscription' },
      { label: 'Account / signup', justdb: 'None', them: 'None for Community Edition' },
      { label: 'Platforms', justdb: 'macOS, Windows', them: 'macOS, Windows, Linux' },
      { label: 'Best for', justdb: 'Browsing, querying and editing, fast', them: 'Broad database coverage and advanced tooling' },
    ],
    switchReasons: [
      { title: 'It opens fast', body: 'A native binary instead of a JVM means the app is ready about as quickly as you can click it — no splash screen, no plugin load.' },
      { title: 'Less UI to learn', body: 'No perspectives, no dozen panels you never open. Tables, a SQL editor and inline editing — the three things you actually came for.' },
      { title: 'Nothing to license', body: 'Every feature is free. There is no PRO tier dangling the capability you happen to need behind a subscription.' },
    ],
    whenThem: [
      'You connect to databases JustDB does not support yet — MySQL, Oracle, SQL Server, MongoDB and friends.',
      'You rely on advanced tooling like ER diagrams, a visual query builder or bulk data transfer between servers.',
      'You are on Linux, where JustDB does not yet publish a packaged build.',
    ],
    faq: [
      { q: 'Is JustDB a drop-in replacement for DBeaver?', a: 'For the common loop — browse tables, run SQL, edit rows — in PostgreSQL, SQLite or Turso, yes. If you depend on DBeaver’s broad database support or its advanced modelling and data-transfer tools, keep DBeaver for those.' },
      { q: 'Is JustDB free like DBeaver Community Edition?', a: 'Yes, and there is no paid tier at all. DBeaver splits features across a free Community Edition and a paid PRO subscription; JustDB ships one free app.' },
      { q: 'Does JustDB use less memory than DBeaver?', a: 'JustDB is a native Rust/Tauri app rather than a JVM application, so it starts quickly and keeps a small footprint. DBeaver’s Java runtime is heavier by design.' },
    ],
  },
  {
    slug: 'pgadmin',
    competitor: 'pgAdmin',
    keyword: 'lightweight pgAdmin alternative',
    title: 'JustDB vs pgAdmin — a faster, native pgAdmin alternative',
    description:
      'JustDB vs pgAdmin, compared honestly. A native desktop PostgreSQL client versus the browser-based official admin tool — speed, footprint and everyday workflow.',
    eyebrow: 'JustDB vs pgAdmin',
    h1: 'A native alternative to pgAdmin.',
    lead: 'pgAdmin is the official PostgreSQL admin tool — thorough, but it runs a local server and drives its UI through the browser, and it is built for deep administration. When you just want to see your tables and edit a row, JustDB is a native app that gets out of your way.',
    them: 'pgAdmin is the official open-source administration and management tool for PostgreSQL. It runs a Python backend and renders its interface in a browser, with deep server administration — roles, backups, dashboards, a PL/pgSQL debugger and more.',
    rows: [
      { label: 'Architecture', justdb: 'Native desktop app (Rust + Tauri)', them: 'Python server + browser-based UI' },
      { label: 'Startup & workflow', justdb: 'Open the app, connect, see rows', them: 'Boots a local server, opens in the browser, more steps to data', win: true },
      { label: 'Databases', justdb: 'PostgreSQL, SQLite, Turso/libSQL', them: 'PostgreSQL only' },
      { label: 'Focus', justdb: 'Browse, query and edit day to day', them: 'Full database administration' },
      { label: 'Price', justdb: 'Free — no paid tier', them: 'Free and open-source' },
      { label: 'Account / signup', justdb: 'None', them: 'None' },
      { label: 'Platforms', justdb: 'macOS, Windows', them: 'macOS, Windows, Linux' },
    ],
    switchReasons: [
      { title: 'No browser tab', body: 'JustDB is a real desktop window, not a local web server you reach through a browser. Passwords live in the OS keychain, not in a web session.' },
      { title: 'Straight to the data', body: 'Skip the server boot and the admin dashboard. Connect, pick a table, and you are looking at rows.' },
      { title: 'SQLite and Turso too', body: 'pgAdmin is Postgres-only. JustDB opens the same window onto SQLite files and Turso/libSQL databases.' },
    ],
    whenThem: [
      'You do serious PostgreSQL administration — managing roles, tablespaces, backups and server configuration.',
      'You need Postgres-specific tooling like the PL/pgSQL debugger or the server dashboard.',
      'You are on Linux, where JustDB does not yet publish a packaged build.',
    ],
    faq: [
      { q: 'Can JustDB replace pgAdmin?', a: 'For everyday work — browsing schemas, running queries and editing rows — yes, with a lighter, native experience. For deep server administration (roles, backups, configuration), pgAdmin remains the more complete tool.' },
      { q: 'Does JustDB run in the browser like pgAdmin?', a: 'No. JustDB is a native desktop app. There is no local server to start and no browser tab — it connects straight from your machine to your database.' },
      { q: 'Does JustDB only work with PostgreSQL?', a: 'No. Unlike pgAdmin, JustDB also opens SQLite files and Turso/libSQL databases from the same app.' },
    ],
  },
  {
    slug: 'beekeeper-studio',
    competitor: 'Beekeeper Studio',
    keyword: 'Beekeeper Studio alternative',
    title: 'JustDB vs Beekeeper Studio — a native, free alternative',
    description:
      'JustDB vs Beekeeper Studio, compared honestly. A native Rust desktop client versus an Electron app — architecture, database support, pricing and focus.',
    eyebrow: 'JustDB vs Beekeeper Studio',
    h1: 'A native alternative to Beekeeper Studio.',
    lead: 'Beekeeper Studio is a clean, modern SQL client — and a close match in spirit to JustDB. The main differences are underneath: Beekeeper is an Electron app with a paid Ultimate tier, while JustDB is a fully native app that is free with no tiers.',
    them: 'Beekeeper Studio is a modern, cross-platform SQL editor and database manager built on Electron, with an open-source Community edition and a paid Ultimate edition that adds databases and features.',
    rows: [
      { label: 'Architecture', justdb: 'Native desktop app (Rust + Tauri)', them: 'Electron (Chromium + Node)', win: true },
      { label: 'Databases', justdb: 'PostgreSQL, SQLite, Turso/libSQL (MySQL planned)', them: 'PostgreSQL, MySQL, SQLite, SQL Server and more' },
      { label: 'Price', justdb: 'Free — no paid tier', them: 'Free Community edition; paid Ultimate edition' },
      { label: 'Feature gating', justdb: 'Every feature is in the free app', them: 'Some databases and features are Ultimate-only' },
      { label: 'Account / signup', justdb: 'None', them: 'None for the Community edition' },
      { label: 'Platforms', justdb: 'macOS, Windows', them: 'macOS, Windows, Linux' },
      { label: 'Focus', justdb: 'Browse, query and edit, minimal', them: 'Broad SQL editing and management' },
    ],
    switchReasons: [
      { title: 'Native, not Electron', body: 'JustDB is built on Rust and Tauri, so it uses the OS webview instead of bundling a full Chromium — a smaller download and a lighter footprint.' },
      { title: 'No tiers', body: 'There is no Community-versus-Ultimate split. Every feature JustDB has is in the one free app.' },
      { title: 'Turso built in', body: 'Connect to remote Turso/libSQL databases over an authenticated URL, alongside PostgreSQL and local SQLite files.' },
    ],
    whenThem: [
      'You need databases JustDB does not support yet, such as MySQL or SQL Server.',
      'You are on Linux, where JustDB does not yet publish a packaged build.',
      'You want features that live in Beekeeper’s Ultimate edition specifically.',
    ],
    faq: [
      { q: 'How is JustDB different from Beekeeper Studio?', a: 'Both aim for a clean, focused SQL client. JustDB is a native Rust/Tauri app that is free with no paid tier; Beekeeper Studio is an Electron app with a free Community edition and a paid Ultimate edition.' },
      { q: 'Is JustDB really free with no Ultimate tier?', a: 'Yes. There is no Community-versus-Ultimate split — every feature ships in the one free app, with no account required.' },
      { q: 'Which supports more databases?', a: 'Beekeeper Studio currently supports more database engines, including MySQL and SQL Server. JustDB focuses on PostgreSQL, SQLite and Turso/libSQL today, with MySQL planned.' },
    ],
  },
];

export const getComparison = (slug: string) => COMPARISONS.find((c) => c.slug === slug);

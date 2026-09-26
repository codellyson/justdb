/**
 * Knowledge-base guides (SEO pillar 5). Short-form, zero-fluff answers to
 * functional "how do I…" questions, each tied naturally back to JustDB. The
 * `body` is Markdown, rendered with `marked` on the guide page.
 *
 * Keep them genuinely useful and honest — a guide that actually answers the
 * question earns the link; a thin doorway page does not.
 */
export interface Guide {
  slug: string;
  keyword: string;
  title: string;
  /** Meta description + card blurb. */
  description: string;
  /** Short label for the guide list. */
  summary: string;
  /** Reading-time-ish tag shown on the card. */
  tag: string;
  body: string;
}

export const GUIDES: Guide[] = [
  {
    slug: 'view-sqlite-tables-locally',
    keyword: 'view SQLite tables locally',
    title: 'How to quickly view SQLite tables locally',
    description:
      'The fastest way to open a local SQLite database and browse its tables and rows — no server, no import, no command line. A short, practical guide.',
    summary: 'Open a .db file and browse its tables and rows in seconds.',
    tag: 'SQLite · 2 min',
    body: `
SQLite keeps a whole database in a single file, which is convenient right up until you want to *look* inside it. The command line works, but typing \`.tables\` and \`SELECT * FROM …\` for every peek gets old fast. Here is the quickest way to browse a local SQLite database visually.

## The fast path

1. **Install a native SQLite viewer.** [JustDB](/alternatives/sqlite-viewer-macos) is a small desktop app for macOS and Windows — download it and open it.
2. **Open your file.** Point it at any \`.db\`, \`.sqlite\` or \`.sqlite3\` file. There is no server to start and no import step; the file opens directly.
3. **Browse.** The left pane lists every table and view with live row counts. Click a table to see its rows in a grid, along with column types, nullability and defaults.

That is the whole loop — from file on disk to rows on screen in a few seconds.

## Look without touching

Browsing is read-only until you decide otherwise. When you *do* want to change something, edits stage up first and you can read the exact SQL before it runs against the file — so opening a database to look never risks changing it by accident.

## From the command line instead

If you prefer the shell, the SQLite CLI covers the basics:

\`\`\`sql
sqlite3 mydata.db
.tables            -- list tables
.schema users      -- show a table's schema
SELECT * FROM users LIMIT 20;
\`\`\`

That is perfect for a one-off check. For anything you do repeatedly — scanning several tables, filtering rows, editing a value — a visual viewer is faster and harder to fat-finger.

## Why JustDB for this

- **Native and quick** — a small app that opens about as fast as you can click it.
- **No server, no signup** — open the file and go; nothing is uploaded anywhere.
- **View, query and edit** in one window, with a Review-SQL step before any write.

[Open your SQLite file in JustDB →](/alternatives/sqlite-viewer-macos)
`,
  },
  {
    slug: 'edit-postgresql-cells-inline',
    keyword: 'edit PostgreSQL cells inline',
    title: 'The fastest way to edit PostgreSQL cells inline',
    description:
      'How to edit PostgreSQL data directly in a grid — change a cell, review the SQL, and commit — without writing UPDATE statements by hand. A short, practical guide.',
    summary: 'Change a value in a grid and review the UPDATE before it runs.',
    tag: 'PostgreSQL · 3 min',
    body: `
Fixing one wrong value in PostgreSQL usually means writing an \`UPDATE\`, remembering the exact \`WHERE\` clause, and hoping you scoped it correctly. For a quick edit that is a lot of ceremony — and a real risk of updating more rows than you meant to. Here is how to edit cells directly and safely.

## Edit in the grid

1. **Connect** to your PostgreSQL database in [JustDB](/alternatives/postgresql-gui) — local, Docker or hosted.
2. **Open the table** and find the row. Filter by a column or search to get to it quickly.
3. **Double-click the cell**, type the new value, and confirm. Add or delete whole rows the same way.

No hand-written \`UPDATE\`, and no chance of an accidental full-table write from a missing \`WHERE\`.

## Review before it's real

The safety part matters: edits **stage up first**. Change a few cells, then open the review step to see the exact SQL that will run — the \`UPDATE\` statements, scoped to each row's primary key — before anything touches the database. Nothing is written until you say so.

## The hand-written equivalent

Inline editing is really just generating this for you, correctly scoped:

\`\`\`sql
UPDATE users
SET email = 'new@example.com'
WHERE id = 42;   -- scoped to the primary key, not a loose filter
\`\`\`

Doing it by hand is fine for one row. The moment you are editing several values across a table, generating the statements from the grid is both faster and safer.

## Why JustDB for this

- **Inline editing** on cells, rows and inserts — no SQL required for the common case.
- **A Review-SQL step** so you always see the exact write before it runs.
- **Cascade preview** before a delete, so you know what a removal takes with it.

[Edit your Postgres data in JustDB →](/alternatives/postgresql-gui)
`,
  },
  {
    slug: 'connect-postgres-in-docker',
    keyword: 'connect to PostgreSQL in Docker',
    title: 'How to connect to a PostgreSQL database running in Docker',
    description:
      'Connect a GUI to PostgreSQL running in a Docker container — find the published port, build the connection string, and browse your data. A short, practical guide.',
    summary: 'Publish the port, paste the connection string, and you are in.',
    tag: 'PostgreSQL · Docker · 3 min',
    body: `
A PostgreSQL container is not special to connect to — it is just a host and a port. The only trick is making sure the port is *published* to your machine, then pointing a client at it. Here is the whole path.

## 1. Publish the port

When you run the container, map the container's 5432 to a port on your host with \`-p\`:

\`\`\`bash
docker run --name pg -e POSTGRES_PASSWORD=secret -p 5432:5432 -d postgres
\`\`\`

The \`-p 5432:5432\` is the important part — it exposes Postgres on \`localhost:5432\`. If 5432 is already taken on your machine, publish a different host port, e.g. \`-p 5433:5432\`, and use \`5433\` below.

Using Docker Compose, the equivalent is:

\`\`\`yaml
services:
  db:
    image: postgres
    environment:
      POSTGRES_PASSWORD: secret
    ports:
      - "5432:5432"
\`\`\`

## 2. Build the connection string

Point your client at the host port you published:

\`\`\`
postgresql://postgres:secret@localhost:5432/postgres
\`\`\`

- **host** \`localhost\` (the container is reachable on your machine's loopback)
- **port** whatever you published on the host side of \`-p\`
- **user / password** from the container's environment
- **database** \`postgres\` by default, or whatever you created

## 3. Connect

In [JustDB](/alternatives/postgresql-gui), paste that connection string and connect. There is nothing Docker-specific to configure — a container is just another host and port. Once connected, browse tables, run SQL and edit rows like any other database.

## If it won't connect

- **Container not running?** Check \`docker ps\` — it should list the container with the port mapping.
- **Port not published?** A container without \`-p\` is only reachable from *inside* Docker's network, not from your host. Add the mapping and restart it.
- **Port clash?** If another Postgres already owns 5432, publish on a different host port and use that in the connection string.

## Why JustDB for this

- **No Docker-specific setup** — point it at \`localhost\` and the published port.
- **Local, Docker or hosted** Postgres over TLS, all the same way.
- **Free, native, no signup** on macOS and Windows.

[Connect to your Dockerized Postgres →](/alternatives/postgresql-gui)
`,
  },
];

export const getGuide = (slug: string) => GUIDES.find((g) => g.slug === slug);

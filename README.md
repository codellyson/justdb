# JustDB

Local desktop app for PostgreSQL, MySQL, and SQLite. Browse tables, run
queries, inspect schemas. Credentials stay on your machine.

- Website: <https://justdb.kreativekorna.com>
- Changelog: <https://justdb.kreativekorna.com/changelog>
- Downloads: <https://github.com/codellyson/justdb/releases>

## Install with Homebrew (macOS)

```sh
brew install --cask codellyson/tap/justdb
```

Works on Apple silicon and Intel Macs. To update, run `brew update` followed by
`brew upgrade --cask justdb`.

The [Homebrew tap](https://github.com/codellyson/homebrew-tap) checks published
stable releases hourly and updates the cask after verifying the installer checksum.

## Workspaces

| Path | What it is |
| --- | --- |
| [`apps/web`](apps/web) | Vite + React SPA — the desktop app's frontend, mounted inside the Tauri webview. |
| [`apps/marketing`](apps/marketing) | Astro static site deployed to Cloudflare Pages (<justdb.kreativekorna.com>). |
| [`src-tauri`](src-tauri) | Rust backend — Tauri commands, `tokio-postgres` client, keychain-backed saved connections. |

## Develop

Prerequisites by OS:

| OS | Required |
| --- | --- |
| macOS | Rust (`brew install rustup-init && rustup-init`), Xcode CLT (`xcode-select --install`) |
| Windows | Rust ([rustup-init.exe](https://rustup.rs)), [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (Desktop C++ workload), WebView2 (preinstalled on Win10/11) |
| Linux | Rust (rustup), `libwebkit2gtk-4.1-dev libsoup-3.0-dev librsvg2-dev libayatana-appindicator3-dev libxdo-dev` |

```bash
pnpm install
pnpm tauri:dev     # native window over the Vite dev server
pnpm dev           # apps/web in the browser only (no Rust backend)
pnpm changelog:unreleased   # preview the section the next release would add
pnpm changelog:rebuild      # destructive: regenerate CHANGELOG.md from git, drops manual edits
```

### WSL2 caveat

WebKitGTK + WSLg is fragile: window draws but the WebView can render as
1×1 pixels. `pnpm tauri:dev` sets the known stabilizers
(`WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1
LIBGL_ALWAYS_SOFTWARE=1`). If it still won't render, build/run from the
host OS (Mac, Windows PowerShell) instead — same repo, different
toolchain.

## Architecture

The frontend talks to Rust over `invoke()`, with no HTTP layer in between
— see [`apps/web/src/lib/db.ts`](apps/web/src/lib/db.ts) for the typed
client. Sessions live in a Rust `DashMap` keyed by an opaque session id
held in browser memory only; webview reload drops the session, matching
process-memory lifetime.

- [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs) — Tauri commands
- [`src-tauri/src/postgres.rs`](src-tauri/src/postgres.rs) — `tokio-postgres` wrapper, auto-reconnect, type-aware row → JSON
- [`src-tauri/src/saved_connections.rs`](src-tauri/src/saved_connections.rs) — OS-keychain-backed connection store
- [`apps/web/src/contexts`](apps/web/src/contexts) — connection, dashboard, theme, pending-changes contexts

## Release

```bash
pnpm release            # auto-bump patch (e.g. 0.1.8 → 0.1.9)
pnpm release 0.2.0      # explicit version
pnpm release -y         # skip the confirmation prompt
```

The script handles the whole choreography: pre-flight checks (clean
tree, on main, in sync with origin), version bump across the three
manifests + `Cargo.lock`, `CHANGELOG.md` regeneration with the new tag
label, then commit / tag / push.

The tag push fires two workflows: `Release` (tauri-action builds and
uploads `.dmg`/`.exe`/`.msi` to the GitHub Release) and `Changelog`
(posts the tag-scoped notes to the release body and commits the
refreshed `CHANGELOG.md` back to main).

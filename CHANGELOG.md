# Changelog

All notable changes to the `scholia` CLI are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Only the published package (`scholia`) is versioned. The `@scholia/*` workspace packages
are internal and unpublished; changes to them appear here only where they affect the CLI.

## [Unreleased]

### Added

- **Open in editor** now opens the editor you are actually using, rather than the
  first one found on `PATH`. Detection reads the terminal scholia was launched from
  — which tells Cursor, Windsurf and VSCodium apart from VS Code, even though all of
  them report themselves as VS Code — then repository markers (`.zed/`, `.idea/`,
  `.vscode/`), then `PATH` (ADR-0017).
- `--editor <command>` for when detection still guesses wrong. Saved to
  `~/.scholia/config`, so it is only ever passed once.
- **Copy path** replaces the button when no editor can be resolved, instead of an
  "Open in editor" that fails on click.

### Changed

- `POST /__open` is loopback-only, unconditionally: requests from a non-loopback
  peer, for a non-loopback `Host`, or carrying proxy/tunnel forwarding headers are
  refused (ADR-0022). Previously it relied on the server binding loopback, which a
  tunnel would invalidate.

## [0.1.0] — 2026-07-25

> **Update (2026-07-26):** `COLLAB_HOSTED` and `@collab/core` below refer to what
> are now `SCHOLIA_HOSTED` and `@scholia/core` (workspace/env-var rename, issue
> #15). Left as originally written — this entry records what the 0.1.0 release
> actually shipped.

First release. Ships **Local Preview** only: `scholia <path>` renders a local markdown
file or folder in your browser. No network calls, no account, no credentials.

### Added

- `scholia [target]` — serve a file or directory over loopback with live reload.
  Flags: `-p, --port`, `--host`, `--no-open`, `--no-mdx`.
- Rendering: GitHub-flavored markdown, KaTeX math, Shiki syntax highlighting, Mermaid
  diagrams, YAML frontmatter, and optional MDX evaluation.
- Directory support: generated nav, client-side search, and Entry Page resolution
  (`index.html` → `index.md` → `README.md`).
- Port handling that matches Vite/Next: an explicit `--port` that is taken is a hard
  error, while the default port falls back to the next open one and prints a notice.
- The default host binds **both** loopback addresses (`127.0.0.1` and `::1`), so the
  server answers whichever one you reach for. Binding the name `localhost` alone
  resolves to only one of them — `::1` on macOS — leaving the other refusing
  connections. An explicit `--host` is still bound verbatim.
- `packages/cli/README.md` as the npm-facing page, documenting the MDX trust boundary
  (`.mdx` is compiled and executed in the CLI process; `--no-mdx` disables it, and plain
  `.md` is never evaluated) — see ADR-0012.

### Not included

Hosted mode is not in this release. `share`, Threads/Conversations, hosted URLs,
accounts, and the agent API exist in the repository but are gated behind
`COLLAB_HOSTED=1` and are not registered in published builds.

### Internal

- Replaced `gray-matter` with `vfile-matter` for frontmatter parsing — ESM-only, no
  `fs` access, and consistent with `@collab/core`'s unified/remark/rehype stack.
- The CLI is bundled with tsup; workspace packages are inlined rather than shipped as
  runtime dependencies. Runtime dependencies are `cac` and `open` only.

[unreleased]: https://github.com/jtmthf/scholia/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jtmthf/scholia/releases/tag/v0.1.0

# scholia

Preview a local markdown file or folder in your browser. One command, no config,
no account, no network.

```sh
npx scholia ./docs
```

That serves `./docs` at <http://localhost:3000>, opens your browser, and reloads
the page when you save a file.

## Install

Run it without installing:

```sh
npx scholia ./docs
```

Or install it globally:

```sh
npm i -g scholia
scholia ./docs
```

Requires **Node 22 or newer**.

## Usage

```sh
scholia [target]
```

`target` is a markdown file or a directory (defaults to the current directory).
Point it at a single file to preview just that file; point it at a folder to get
the whole tree with navigation and search.

| Flag                | Description                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-p, --port <port>` | Port to listen on. Default `3000`. An explicit port that is taken is a hard error; without this flag, a busy default falls back to the next open port and says so.    |
| `--host <host>`     | Host to bind. Default `localhost`, which binds both loopback addresses (`127.0.0.1` and `::1`) so either one reaches the server. An explicit value is bound verbatim. |
| `--no-open`         | Don't open the browser automatically.                                                                                                                                 |
| `--no-mdx`          | Render `.mdx` as plain markdown instead of evaluating it. See below.                                                                                                  |
| `--editor <cmd>`    | Editor for "Open in editor", e.g. `cursor`. Saved to `~/.scholia/config`, so you only pass it once. See below.                                                        |
| `-h, --help`        | Show help.                                                                                                                                                            |
| `-v, --version`     | Show the version.                                                                                                                                                     |

## What renders

- **Markdown** with GitHub-flavored extensions — tables, task lists, strikethrough,
  footnotes, and GitHub-style alert blockquotes (`> [!NOTE]`).
- **Math** via KaTeX (`$inline$` and `$$block$$`). KaTeX's fonts and CSS are
  vendored, so math renders offline.
- **Syntax highlighting** via Shiki, with grammars loaded lazily per language.
- **Mermaid diagrams**, rendered in the browser.
- **YAML frontmatter** — a `title:` key sets the page title; the frontmatter block
  itself is stripped from the output.
- **MDX** (`.mdx`), evaluated as Preact. See the trust note below.
- **Directory navigation** — a sidebar built from the file tree, with per-directory
  entry pages resolved as `index.html` → `index.md` → `README.md`.
- **Full-text search** across the previewed tree.
- **Live reload** — edits to watched files refresh the open page.

Non-markdown files in the tree (images, CSS, data files) are served as-is.

## Open in editor

Every page has an **Open in editor** button, which opens that file in the editor
you are actually using — not the first one it can find installed. scholia works
that out from the terminal it was launched from: an integrated terminal names its
editor exactly, including telling Cursor, Windsurf and VSCodium apart from VS Code
(they all report themselves as VS Code). Failing that it looks for `.zed/`,
`.idea/` or `.vscode/` in the previewed tree, and only then falls back to
searching your `PATH`.

If it still guesses wrong, say so once:

```sh
scholia ./docs --editor cursor
```

That is saved to `~/.scholia/config` and used from then on. When no editor can be
found at all, the button is replaced by **Copy path** rather than left there to
fail on click.

The endpoint behind the button (`POST /__open`) only ever accepts same-origin
requests from loopback, so no other page in your browser — and nothing off your
machine — can make your editor open files. If you bind a non-loopback `--host`
and read the preview from another address, you get **Copy path** there too: the
button is only offered to whoever is at the machine holding the files.

## MDX runs code on your machine

`.mdx` files are **evaluated**, not just parsed: scholia compiles and executes the
file as Preact code in the CLI process, on your machine, with your permissions.
That's the same trust level as running any local dev server or build tool — and it
means the same rule applies: **only preview files you trust.**

If you're looking at markdown from somewhere you don't control, pass `--no-mdx`.
`.mdx` files are then served as plain markdown, with no evaluation at all. Plain
`.md` files are never evaluated, with or without the flag.

This boundary is a deliberate architectural line, not an implementation detail —
MDX is evaluated only on trusted surfaces (your own machine), and the future hosted
service will never execute it. See
[ADR-0012](https://github.com/jtmthf/scholia/blob/main/docs/adr/0012-hosted-pages-are-always-static-html.md).

## What this is — and isn't yet

**v0.1 is Local Preview only.** It reads files off your disk and serves them to
your browser over loopback. It makes no outbound network requests, stores no
credentials, and talks to no server or database. There is nothing to sign up for.

The larger project this comes from is a service for hosting documents and letting
humans and AI agents collaborate on them through anchored comment threads —
publishing a document to a shareable URL, leaving comments bound to specific
passages, re-publishing a new version with comments migrating forward, and an
agent-facing API for reviewer agents.

**None of that ships in v0.1.** There is no `share` command, no comment threads, no
hosted URLs, no accounts, and no agent API in this release. If you're here because
that's what you wanted, this isn't it yet — please don't file bugs against sharing
functionality that isn't in the package. Watch the repo for the hosted release.

## Links

- Source: <https://github.com/jtmthf/scholia>
- Issues: <https://github.com/jtmthf/scholia/issues>
- Architecture decisions: <https://github.com/jtmthf/scholia/tree/main/docs/adr>

# Scholia

Preview markdown on your own machine, and — eventually — publish it somewhere
humans and AI agents can annotate it together through anchored comment threads.

*Scholia* are the marginal annotations classical commentators layered onto a text:
anchored, multi-author notes on a document. That's the whole idea.

**Shipping today: `scholia <path>`, the Local Preview CLI.** Everything hosted is
built in this repo but not released yet — see [Hosted mode](#hosted-mode-not-shipped-yet).

## Quick start

```sh
npx scholia ./docs
```

Serves `./docs` at <http://localhost:3000>, opens your browser, and live-reloads on
save. No account, no token, no network. Requires Node 22+.

Or install it:

```sh
npm i -g scholia
scholia ./docs
```

Markdown with GFM, KaTeX math, Shiki highlighting, Mermaid, frontmatter, MDX,
directory nav, and full-text search. Full CLI docs, flags, and the MDX trust
boundary: [`packages/cli/README.md`](./packages/cli/README.md).

> [!IMPORTANT]
> `.mdx` files are **evaluated** as code on your machine. Only preview files you
> trust, or pass `--no-mdx`.

## Hosted mode (not shipped yet)

The rest of this repo is a zero-config service for hosting markdown and HTML
documents and letting humans and AI agents collaborate on them through anchored
comment threads: publish a Page to a Share URL, select text to leave a Thread
bound to that passage, re-upload to create a new Version with comments migrating
forward, per-Version permalinks and a source Diff, an Outdated rail for Threads
whose anchors no longer match, private Chats scoped to a Viewer, viewer-scoped
agent tokens, Promotion of Chat messages into public Threads, GitHub PR-backed
Sites, and a REST + MCP surface for reviewer agents.

That code is written and works — the repo is at **M11** — but **none of it is in
the released package.** The `share`, `chats`, `state`, `rotate-share`,
`rotate-token`, and `delete-site` commands are hidden from the CLI unless you set
`COLLAB_HOSTED=1`, and they need a server, Postgres, and a blob store you'd have to
run yourself (see [Development](#development)). Treat hosted mode as a roadmap
item, not a feature you can use.

See [`CONTEXT.md`](./CONTEXT.md) for the domain language, [`PLAN.md`](./PLAN.md)
for the build sequence, and [`docs/adr/`](./docs/adr) for the architecture
decisions.

## Packages

The published npm package is `scholia` (from `packages/cli`). The `@collab/*`
scope is an internal pnpm workspace namespace — those packages are not published,
and the ones the CLI needs are bundled into its binary.

| Package          | Role                                                                 |
| ---------------- | ------------------------------------------------------------------- |
| `scholia`        | The `scholia` command. `scholia <path>` runs Local Preview; the hosted commands are gated behind `COLLAB_HOSTED=1`. |
| `@collab/core`   | Pure domain logic: render, Nav, search, Entry Page, content-addressed blobs. No HTTP/db. |
| `@collab/local`  | Local Preview server (Hono): file-watch, live-reload, SSR'd reading view. |
| `@collab/db`     | Drizzle schema + client + repositories for the mutable metadata. |
| `@collab/server` | Hono REST API + content-origin server (`POST /sites`, content origin). |
| `@collab/web`    | Preact + Vite viewer SPA — loads a Share URL, renders the Page in a sandboxed iframe. |

## Development

```sh
pnpm install
pnpm typecheck     # tsc across the workspace — this is also the lint
pnpm test:ci       # vitest, scoped to the shipping + pure packages
```

Run the CLI from source:

```sh
pnpm --filter @collab/local build   # build the browser bundle once
pnpm collab ./path/to/docs
```

Build the publishable binary:

```sh
pnpm --filter scholia build         # → packages/cli/dist/cli.js
```

For the hosted path you also need Postgres and a blob store:

```sh
docker compose up -d                 # Postgres (host port 5544) + MinIO
cp .env.example .env
pnpm db:migrate
pnpm dev:server                      # REST API + content origin on :8787
pnpm dev:web                         # viewer SPA on :5173 (separate terminal)

COLLAB_HOSTED=1 pnpm collab share ./path/to/page.md
```

Server and db tests silently skip unless `DATABASE_URL` is set — see
[`CLAUDE.md`](./CLAUDE.md) for the exact invocation.

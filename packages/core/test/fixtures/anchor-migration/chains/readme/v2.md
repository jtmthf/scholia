# Collab

A zero-config service for hosting markdown and HTML documents and letting humans
and AI agents collaborate on them through anchored comment threads. See
[`CONTEXT.md`](./CONTEXT.md) for the domain language and [`PLAN.md`](./PLAN.md)
for the build sequence.

This repo is at **M6 (Versioning UX)**: the monorepo skeleton, the shared
`@collab/core` render/Nav/search engine (folded in from `mdttp`), the
`collab <path>` Local Preview spine, hosted multi-Page Sites (`collab share`),
anchored public comment Threads — and now **re-upload → new Version** with
best-effort text-quote comment migration, an Outdated rail, per-Version
permalinks, a source-level Diff, and viewer Last Seen tracking.

## Quick start

### Local Preview (no account, token, or network)

```sh
pnpm install

# Build the Local Preview browser bundle once (client JS/CSS + vendored KaTeX).
pnpm --filter @collab/local build

# Preview a local markdown file or folder.
pnpm collab ./path/to/docs
```

### Share a Page (hosted)

```sh
pnpm install
docker compose up -d                 # Postgres + MinIO (blob store)
cp .env.example .env                 # DB + S3 config for the server

pnpm db:migrate                      # apply the schema
pnpm dev:server                      # REST API + content origin on :8787
pnpm dev:web                         # viewer SPA on :5173 (separate terminal)

# Upload a markdown file; prints a Share URL and saves the owner token.
pnpm collab share ./path/to/page.md

# Re-run in the same place to publish a NEW Version (comments migrate forward).
pnpm collab share ./path/to/page.md          # uses the .collab marker + owner token
pnpm collab share ./path/to/page.md --new    # force a brand-new Site instead
```

Open the printed Share URL (`http://localhost:5173/s/<slug>`) to read the hosted
Page, select text to leave anchored comment Threads, and — after a re-upload —
see the "what changed" banner, per-Version permalinks (`?v=<n>`), the source Diff,
and Outdated Threads whose anchors no longer match Latest.

## Packages

| Package          | Role                                                                 |
| ---------------- | ------------------------------------------------------------------- |
| `@collab/core`   | Pure domain logic: render, Nav, search, Entry Page, content-addressed blobs. No HTTP/db. |
| `@collab/local`  | Local Preview server (Hono): file-watch, live-reload, SSR'd reading view. (ex-mdttp.) |
| `@collab/cli`    | The `collab` command. `collab <path>` runs Local Preview; `collab share` publishes. |
| `@collab/db`     | Drizzle schema + client + repositories for collab's mutable metadata. |
| `@collab/server` | Hono REST API + content-origin server (`POST /sites`, content origin). |
| `@collab/web`    | Preact + Vite viewer SPA — loads a Share URL, renders the Page in a sandboxed iframe. |

## Development

```sh
pnpm typecheck     # tsc across the workspace
pnpm test          # vitest (core + local + server)
pnpm db:generate   # generate the initial Drizzle migration

docker compose up -d   # Postgres + MinIO for the hosted path (M2+)
```

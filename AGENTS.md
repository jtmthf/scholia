# Scholia

Zero-config service for hosting markdown/HTML docs and letting humans + AI agents
collaborate on them through anchored comment threads. TypeScript, Node 22, pnpm
workspaces, Hono + Preact everywhere.

Two docs carry the design — read the relevant one before non-trivial work; don't
duplicate them here:

- **`CONTEXT.md`** — the domain language. Use its exact, Capitalized terms (Site,
  Page, Version, Anchor, Conversation/Thread/Chat, Outdated, Promotion, Nav, Source
  Map). Each term has an `_Avoid_` list of words not to use. Match this vocabulary in
  code, comments, and UI.
- **`docs/adr/`** — the architecture decisions. Skim before changing architecture;
  record significant decisions as a new ADR. The DB is always authoritative (Scholia
  hosts rendered Versions; the git repo stays canonical for source).

## Packages (`packages/*`, all `@scholia/*`)

| Package                             | Role                                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `core`                              | Pure domain logic: render, Nav, search, Entry Page, content-addressed blobs. **No HTTP/db** — keep it that way. |
| `db`                                | Drizzle schema + client + repositories (Postgres).                                                              |
| `sidecar`                           | The Sidecar: one append-only YAML stream per Conversation, beside the content (ADR-0018/0019).                  |
| `server`                            | Hono REST API + content origin.                                                                                 |
| `ui`                                | Shared comment layer (rail, Conversations, Composer). **Preact only** — no bundler/server dep (ADR-0030).       |
| `web`                               | Preact + Vite viewer, SSR'd by its own Hono route (ADR-0011).                                                   |
| `local`                             | Local Preview server (Hono), ex-mdttp.                                                                          |
| `cli`                               | The `scholia` command (`scholia <path>` previews, `scholia share` publishes).                                   |
| `client`, `mcp`, `github`, `bridge` | Thin clients / integrations over the above. `bridge` also owns the DOM half of anchoring, shared with `local`.  |

## Commands

```sh
pnpm typecheck                          # tsc across the workspace
pnpm lint                               # oxlint --type-aware (catches what tsc misses)
pnpm format                             # oxfmt (Prettier-compatible)
pnpm test                               # vitest — but see the Postgres note below
pnpm --filter @scholia/server typecheck  # one package
pnpm e2e                                # Playwright (needs the stack running)
pnpm e2e:local                          # Playwright, Local Preview only — no stack, no DB
pnpm dev:server                         # REST API + content origin on :8787
pnpm dev:web                            # viewer (Vite + the Hono SSR route) on :5173
pnpm scholia <path>                      # Local Preview
```

oxlint (`pnpm lint`) + oxfmt (`pnpm format`) from the oxc project (ADR-0024).
`tsc` remains the type gate. TS is ESM/NodeNext: **relative
imports use the `.js` extension** even for `.ts` files (e.g. `import { createApp } from
"../src/app.js"`).

## Changesets

Every PR needs a changeset; agents [write the file directly](.changeset/README.md), releases automate on merge via OIDC (ADR-0026).

## Running the hosted-path tests (the trap)

Server/db integration tests **silently skip when `DATABASE_URL` is unset** — a green
`pnpm test` can mean the whole hosted-path suite never ran. `vitest.config.ts` does not
load `.env.test`, so pass the URL inline:

```sh
docker compose up -d        # Postgres (host port 5544) + MinIO
pnpm db:migrate
DATABASE_URL=postgres://scholia:scholia@127.0.0.1:5544/scholia pnpm test
```

Postgres is on host port **5544, not 5432** (avoids clashing with a host-managed
Postgres), and use **`127.0.0.1`, not `localhost`** (sidesteps IPv6 `::1`). Getting this
wrong is the most common failure in this repo.

`pnpm e2e` needs the same stack plus two things CI sets for you (`check.yml`, job
`e2e`) and a local shell doesn't:

```sh
cp .env.example .env                  # the API server reads it; gitignored
SCHOLIA_HOSTED=1 pnpm e2e             # registers `scholia share`, which the seed drives
```

Without `SCHOLIA_HOSTED=1` every hosted spec fails at `runShare` with
``CACError: Unknown option `--server` `` — the hosted commands aren't registered, so
cac never matches `share`. It reads like a CLI bug and isn't.

## Local Preview

`pnpm scholia <path>` needs the browser bundle built first (once): `pnpm --filter
@scholia/local build`. Local Preview touches no network, DB, or token.

Its chrome lives in `packages/local/src/render/layout.tsx` (Preact SSR on the Hono route
— ADR-0011). `packages/local/test/__snapshots__/*.txt` pin the rendered DOM, so altering
the chrome means updating them deliberately; `pnpm e2e:local` covers it in a real browser,
including with JavaScript disabled.

Local Preview hosts Conversations (ADR-0018), and three things about how follow from
ADR-0031:

- **Page content is in the chrome document**, not a frame — for both Page kinds. A `.html`
  file is a Page: it renders through `ingestHtml` into the same `<article>`, with its own
  stylesheets hoisted into the head.
- **The comment rail is server-rendered, and is the page's only hydration boundary.** Every
  other control is wired by delegation. `client.js` calls `hydrate()` on `#scholia-comments`
  and nothing else, so live reload must never swap that element — swap
  `#scholia-comments-data` and re-render instead.
- **A Comment binds to the content hash captured at render**, written onto the article as
  `data-content-hash` and handed back on submit, never re-read from disk.

## The hosted viewer

`@scholia/web` is SSR'd by its own Hono route, not a static SPA (ADR-0011). Two
consequences when editing it:

- **Nothing outside `entry-client.tsx` may import CSS**, and nothing may touch
  `localStorage`/`window`/`matchMedia` at render time — the shell renders in Node.
  Viewer identity and the Owner token go through the hooks in `src/data/identity.ts`,
  which return null until mounted on purpose.
- **`pnpm --filter @scholia/web build` builds both halves** (client, then `--ssr`).
  `packages/web/test/ssr.test.ts` covers the rendered document against a stubbed API;
  `pnpm e2e` covers the browser.

The comment layer itself is `@scholia/ui` — shared with Local Preview, so it takes
data as props and behaviour as a `CommentsPort` and knows nothing about Sites, tokens
or Versions (ADR-0030).

## Agent skills

### Issue tracker

GitHub Issues via the `gh` CLI (repo: jtmthf/scholia). See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

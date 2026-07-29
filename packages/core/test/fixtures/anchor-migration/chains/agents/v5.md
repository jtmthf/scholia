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
| `server`                            | Hono REST API + content origin.                                                                                 |
| `web`                               | Preact + Vite viewer SPA (sandboxed content iframe).                                                            |
| `local`                             | Local Preview server (Hono), ex-mdttp.                                                                          |
| `cli`                               | The `scholia` command (`scholia <path>` previews, `scholia share` publishes).                                   |
| `client`, `mcp`, `github`, `bridge` | Thin clients / integrations over the above.                                                                     |

## Commands

```sh
pnpm typecheck                          # tsc across the workspace
pnpm lint                               # oxlint --type-aware (catches what tsc misses)
pnpm format                             # oxfmt (Prettier-compatible)
pnpm test                               # vitest — but see the Postgres note below
pnpm --filter @scholia/server typecheck  # one package
pnpm e2e                                # Playwright (needs the stack running)
pnpm dev:server                         # REST API + content origin on :8787
pnpm dev:web                            # viewer SPA on :5173
pnpm scholia <path>                      # Local Preview
```

oxlint (`pnpm lint`) + oxfmt (`pnpm format`) from the oxc project (ADR-0024).
`tsc` remains the type gate. TS is ESM/NodeNext: **relative
imports use the `.js` extension** even for `.ts` files (e.g. `import { createApp } from
"../src/app.js"`).

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

## Local Preview

`pnpm scholia <path>` needs the browser bundle built first (once): `pnpm --filter
@scholia/local build`. Local Preview touches no network, DB, or token.

## Agent skills

### Issue tracker

GitHub Issues via the `gh` CLI (repo: jtmthf/scholia). See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

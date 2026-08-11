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

| Package                      | Role                                                                                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core`                       | Pure domain logic: render, Nav, search, Entry Page, content-addressed blobs, plus the application layer's verb set (ADR-0020/0021). **No HTTP/db** — keep it that way. |
| `db`                         | Drizzle schema + client + repositories (Postgres).                                                                                                                     |
| `sidecar`                    | The Sidecar: one append-only YAML stream per Conversation, beside the content (ADR-0018/0019).                                                                         |
| `server`                     | Hono REST API + content origin.                                                                                                                                        |
| `ui`                         | Shared comment layer (rail, Conversations, Composer). **Preact only** — no bundler/server dep (ADR-0030).                                                              |
| `web`                        | Preact + Vite viewer, SSR'd by its own Hono route (ADR-0011).                                                                                                          |
| `local`                      | Local Preview server (Hono), ex-mdttp.                                                                                                                                 |
| `cli`                        | The `scholia` command (`scholia <path>` previews, `scholia share` publishes, `scholia mcp` serves MCP).                                                                |
| `client`, `github`, `bridge` | Thin clients / integrations over the above. `bridge` also owns the DOM half of anchoring, shared with `local`.                                                         |

## Commands

```sh
pnpm build                              # turbo run build — tsup, every package, dependencies first
pnpm typecheck                          # turbo run typecheck — tsc per package (also emits dist/*.d.ts)
pnpm lint                               # oxlint --type-aware (catches what tsc misses)
pnpm format                             # oxfmt (Prettier-compatible)
pnpm test                               # turbo run test, cached per package — but see the Postgres note below
pnpm test:watch                         # turbo watch test — re-runs affected packages on change
pnpm test:projects                      # vitest run, every package in one process — local, all-at-once
pnpm scholia <path>                     # Local Preview — builds its dependencies first
pnpm scholia mcp                        # the same verbs over MCP (stdio; --http for HTTP)
pnpm --filter @scholia/server typecheck # one package, no dependency build
turbo run build --filter=@scholia/server... # one package + the dependencies it actually needs
pnpm --filter @scholia/e2e e2e          # Playwright (needs the stack running)
```

oxlint (`pnpm lint`) + oxfmt (`pnpm format`) from the oxc project (ADR-0024).
`tsc` remains the type gate, run per package by Turborepo (ADR-0037) rather than
once at the root; `typecheck` is also what emits each package's `dist/*.d.ts` —
`tsup`'s own declaration output doesn't work under TypeScript 7 yet, so `build`
(`tsup`) owns the JS and `typecheck` (`tsc`) owns the types. TS is ESM/NodeNext:
**relative imports use the `.js` extension** even for `.ts` files (e.g.
`import { createApp } from "../src/app.js"`).

Every `@scholia/*` package resolves through `dist/` (its `package.json`
`exports`/`main`), never `src/` — build is load-bearing, not a release-only
step. `turbo run <task>` chains `dependsOn: ["^build", ...]` so this is
automatic through turbo, but a handful of commands intentionally run outside
turbo and need `dist/` built by hand first: `pnpm test:projects` (raw
`vitest run`, so every project gets one combined JSON report) and Playwright's
`webServer` (boots `@scholia/server` directly via `tsx`, so it can stay up as
a long-lived process). Skipping the explicit `pnpm build` before either one
surfaces as `Failed to resolve entry`/`ERR_MODULE_NOT_FOUND` for some
workspace package, which reads like a config bug in that package rather than
a missing build step. If you add another command that imports a workspace
package at runtime outside of `turbo run`, it needs the same explicit build.

`turbo.json` runs in strict `envMode` (the v2 default): a task's process only
sees an environment variable if that task's own `env` array names it —
package/task overrides don't inherit the base task's list, so each override
restates its own. A task reading `process.env.FOO` without declaring `FOO`
doesn't error; `FOO` is just silently absent from that process, so the bug
surfaces as wrong runtime behavior one layer past turbo (e.g. a CLI flag
silently not registering), not as a turbo failure pointing at the cause.
Before adding a new `process.env.*` read to code that runs under a turbo
task, add it to that task's `env` array in `turbo.json` — grep the task's
package for existing `process.env.` reads to check what's already missing.

## Changesets

A PR that touches runtime code bundled into the release needs a changeset. Pure-test/doc/config changes don't. When in doubt, add one; `pnpm changeset --empty` is the escape hatch for no-op releases. Agents [write the file directly](.changeset/README.md), releases automate on merge via OIDC (ADR-0026).

## Running the hosted-path tests

Server/db integration tests need a Postgres database. `@scholia/db` and
`@scholia/server` each have their own `vitest.config.ts` with a `globalSetup`
(`@scholia/db`'s own `test/setup.ts`, exported as `@scholia/db/test/setup.js`
so `@scholia/server` can point at the same one) that creates a fresh isolated
database for every test run, migrates it, points `DATABASE_URL` at it, and drops
it on teardown. A missing `DATABASE_URL` fails loudly instead of silently
skipping. `DATABASE_URL` has to be set in the shell — pass it inline:

```sh
docker compose up -d        # Postgres (host port 5544) + MinIO
pnpm --filter @scholia/db migrate
DATABASE_URL=postgres://scholia:scholia@127.0.0.1:5544/scholia pnpm test
```

`pnpm test` is `turbo run test`; turbo forwards `DATABASE_URL` through to every
package's task (`turbo.json`'s `test` task declares it in `env`), so the one
`DATABASE_URL=...` above reaches `@scholia/db` and `@scholia/server` however
many other packages' tests turbo also runs. Postgres is on host port **5544,
not 5432** (avoids clashing with a host-managed Postgres), and use
**`127.0.0.1`, not `localhost`** (sidesteps IPv6 `::1`). Getting this wrong is
the most common failure in this repo.

`pnpm --filter @scholia/e2e e2e` needs the same stack plus two things CI sets
for you (`check.yml`, job `e2e`) and a local shell doesn't:

```sh
cp .env.example .env                    # the API server reads it; gitignored
SCHOLIA_HOSTED=1 pnpm --filter @scholia/e2e e2e  # registers `scholia share`, which the seed drives
```

Without `SCHOLIA_HOSTED=1` every hosted spec fails at `runShare` with
``CACError: Unknown option `--server` `` — the hosted commands aren't registered, so
cac never matches `share`. It reads like a CLI bug and isn't. Setting it in the
shell is necessary but not sufficient: `scholia share` inside the e2e helper
runs through `pnpm scholia` → `turbo run scholia`, so the var also has to be
in that task's `env` array in `turbo.json` (see the strict-envMode note above)
or turbo strips it before the CLI process ever sees it, with the same error.

Two more gaps between a local e2e run and CI's, both silent (they don't error,
they just behave differently): `playwright.config.ts` starts `@scholia/server`
with `dev` (`tsx watch`) locally but `start` (no watch) under `CI` — running
locally without `CI=1` leaves the watcher live, and a concurrent `scholia
share` rebuilding `@scholia/local`'s `dist/` mid-suite can trigger a reload
that drops other tests' in-flight requests; set `CI=1` locally to match. And
`.env` is gitignored and hand-maintained per checkout — if blob/S3 calls fail
with an opaque 403, diff it against `.env.example` before suspecting the code;
credential drift there produces failures indistinguishable from a real bug.

`playwright.config.ts` runs CI with a single worker (`workers: CI ? 1 : ...`).
Every `runShare` call now goes through `turbo run scholia`, which forks child
processes to verify/rebuild `@scholia/local` — real CPU load per test that
didn't exist before universal dist exports — on top of Playwright's own
worker + browser processes and `startLocalPreview`'s direct `tsx` spawn
(`e2e/helpers/local-preview.ts`). Running that concurrently on a standard
GitHub Actions runner forks enough processes to intermittently starve it:
`spawn .../node_modules/.bin/tsx ENOENT` even though nothing in the repo ever
touches that binary, and it survives Playwright's own retry. If e2e flakes
with a `spawn ... ENOENT` on a binary that provably exists, suspect resource
contention from concurrent workers before suspecting the binary or the test.

## Local Preview

`pnpm scholia <path>` builds `@scholia/local`'s browser bundle first automatically
(`turbo run scholia` depends on `^build`); Local Preview itself touches no network,
DB, or token.

Its chrome lives in `packages/local/src/render/layout.tsx` (Preact SSR on the Hono route
— ADR-0011). `packages/local/test/__snapshots__/*.txt` pin the rendered DOM, so altering
the chrome means updating them deliberately;
`SCHOLIA_E2E_NO_WEBSERVER=1 pnpm --filter @scholia/e2e e2e local-preview.spec.ts
local-comments.spec.ts` covers it in a real browser, including with JavaScript disabled.

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

## The agent surfaces

The CLI and MCP are **both** agent surfaces and neither is primary (ADR-0021). They render
one command and query set — `packages/core/src/app/verbs.ts`, the application layer of
ADR-0020 — so adding a verb lights it up on both and drift is unrepresentable. Five rules
follow:

- **A verb is declared once**, with the prose an LLM reads and the CLI hints (positional
  order, aliases) that keep the command pleasant to type. `packages/cli/test/parity.test.ts`
  asserts the two surfaces expose the same set, reading the real cac commands and a real
  MCP `tools/list`.
- **The Agent Docs are generated from that registry**, never written beside it
  (`packages/core/src/app/docs.ts`): every instance serves its own, so a Local Preview
  (`/__agent-docs`) documents no accounts and a hosted server (`/agent-docs`) documents its
  tiers. A verb's `description` must stay true of both targets — anything true of only one
  goes in its `notes.local` / `notes.hosted`. The packaged copy at
  `packages/cli/skills/scholia/SKILL.md` is generated too: change the generator, then run
  `pnpm --filter scholia skill`.
- **MCP is `scholia mcp`, not a package** — the CLI is already the install. In stdio mode
  **stdout belongs to the protocol**: nothing on that path may `console.log`.
- **The target is local by default.** `createLocalApi` (`@scholia/sidecar`) invokes the
  application in-process against the Sidecar; `createRemoteApi` (`@scholia/client`)
  implements the same interface over HTTP, and `--server`/`SCHOLIA_SERVER` picks it. An
  agent must be able to comment with no server running — from CI, from a git hook.
- **Two writers is normal**, so a preview server and an agent write the same files at once.
  That is safe because every write is one atomic append (ADR-0019), and it is _useful_
  because the watcher looks inside `.scholia` — an agent's Comment reaches an open preview
  over the existing live-reload channel.

## The hosted viewer

`@scholia/web` is SSR'd by its own Hono route, not a static SPA (ADR-0011). Two
consequences when editing it:

- **Nothing outside `entry-client.tsx` may import CSS**, and nothing may touch
  `localStorage`/`window`/`matchMedia` at render time — the shell renders in Node.
  Viewer identity and the Owner token go through the hooks in `src/data/identity.ts`,
  which return null until mounted on purpose.
- **`pnpm --filter @scholia/web build` builds both halves** (client, then `--ssr`).
  `packages/web/test/ssr.test.ts` covers the rendered document against a stubbed API;
  `pnpm --filter @scholia/e2e e2e` covers the browser.

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

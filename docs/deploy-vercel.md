# Deploying to Vercel

M11 (ADR-0015) adds Vercel as a second supported hosted target alongside
self-host (`pnpm dev:server` / a long-running Node process). Self-host defaults
are unchanged — everything here is opt-in, and only the Vercel adapter
(`packages/server/src/adapters/vercel.ts`) hardcodes any of it.

Two separate Vercel projects, both pointed at this monorepo:

- **`web`** — the static Viewer SPA (`packages/web`).
- **`server`** — the REST API + content origin, via the Vercel adapter.

## `server` project

**Root Directory:** `packages/server`.

Vercel builds `packages/server/api/[[...route]].ts` (a thin re-export of the
adapter) as a Node.js Function handling every route. `packages/server/vercel.json`
registers the Cron job that drives outbound-mirror retry + inbound reconcile
(see below) — no self-host operator ever needs this file.

### Environment variables

Same variables as self-host (`.env.example`: `DATABASE_URL`, `S3_*`,
`PUBLIC_URL`, `VIEWER_URL`, `GITHUB_*`), plus:

| Var | Notes |
| --- | --- |
| `GITHUB_APP_PRIVATE_KEY` | Required (not `_PATH`) if GitHub integration is on — Vercel has no mountable secret-file volume. The adapter throws at boot if `GITHUB_APP_PRIVATE_KEY_PATH` is set. |
| `SCHOLIA_INTERNAL_SECRET` | Required. Gates `POST/GET /internal/drain`. Set it to the **same value** as Vercel's `CRON_SECRET` (see below). |
| `CONTENT_URL` | Set to your wildcard content domain (see below) rather than `PUBLIC_URL`. |

`SCHOLIA_RATELIMIT_STORE` doesn't need setting — the adapter forces
`PostgresRateLimiter` regardless, since the in-memory limiter is silently wrong
across concurrent Lambda instances. `createDb` opens a `max: 1` pool per
invocation (a serverless-sized pool, not a persistent-process pool).

### Cron: `/internal/drain`

Self-host retries outbound mirror dispatch and polls inbound reconcile from a
`setInterval` started at boot. There's no persistent process on Vercel to run
that in, so `vercel.json`'s `crons` entry has Vercel itself call
`POST /internal/drain` every 5 minutes instead — same underlying
`runMirrorDrain` function either way.

Vercel Cron requests always use **GET**, but the route also accepts POST for
manual/other-scheduler triggering, so no special-casing is needed either way.

Vercel automatically populates cron-triggered requests with
`Authorization: Bearer $CRON_SECRET`, using a `CRON_SECRET` System Environment
Variable Vercel creates for you (Project Settings → Environment Variables).
Set `SCHOLIA_INTERNAL_SECRET` to that same value so the route's own bearer check
accepts Vercel's calls. Without GitHub configured, `/internal/drain` still
responds 200 with `{ drained: false, reconciled: 0 }` — the mirror bus/reconcile
poll are no-ops without a registered provider.

## `web` project

**Root Directory:** `packages/web`. Standard Vite static build
(`pnpm build` → `dist/`).

| Var | Notes |
| --- | --- |
| `VITE_API_URL` | Base URL of the `server` deployment above. |

## Wildcard content origin

`contentWildcard: true` is forced on for the Vercel adapter: each Site gets its
own subdomain (`<slug>.<content-host>`) as its content origin, so one Site's
page JS can't script another's (this matters once the deployment is genuinely
multi-tenant — self-host's default path-based serving stays the common case).
This needs:

- A wildcard DNS record (`*.<content-host>`) pointed at the `server` deployment.
- A wildcard TLS certificate covering it (Vercel issues these automatically for
  a wildcard domain added to the project).
- `CONTENT_URL` set to `https://<content-host>` (without the per-Site subdomain
  — `contentBaseFor()` prepends the slug per request).

For local testing of wildcard behavior without real DNS, use a wildcard proxy
such as [vercel-labs/portless](https://github.com/vercel-labs/portless).

# Server assumes no persistent process; Vercel becomes a supported hosted-deployment target

## Status

accepted

## Context & Decision

ADR-0011 picked Hono partly because it "deploys to Cloudflare Workers, matching the
PLAN's R2 content-origin/edge grain" — deployment portability was a goal from the
start. Scoping out a Vercel deployment for the *official hosted* service (not just
self-host — genuinely multi-tenant, per CONTEXT.md's "self-host *and* hosted"
Retention & limits language) surfaced two places where M9/M10 quietly broke that goal
by assuming a single, persistent Node process:

- **The outbound mirror bus** (`mirror/bus.ts`, M10): `emit()` spawned an in-memory
  `setTimeout` retry-with-backoff loop expected to keep running after the triggering
  request returned, and `startReconcilePoller` (`mirror/reconcile.ts`) drove both
  outbound retry and inbound reconciliation off a `setInterval` started once at boot.
  Neither survives a serverless function that terminates at the response.
- **The rate limiter** (`rate-limit.ts`, M9): an in-memory `Map` keyed per-process.
  Correct for self-host's typical single instance, silently wrong across the many
  concurrent Lambda instances a busy hosted Site gets on Vercel — the effective limit
  becomes `limit × warm-instance-count`.

We decided:

1. **Mirror dispatch drops the in-process retry loop.** `emit()` still persists a
   `pending` `comment_mirrors` row before attempting dispatch (unchanged), but now
   attempts it once, inline, synchronously in the request. Retries are handled by a
   periodic **drain** that sweeps pending/failed-under-cap rows — the durable state
   this needs already existed (`drainNow()`, originally just for startup replay).
2. **Reconcile and drain share one trigger**, exposed platform-agnostically at
   `POST /internal/drain` (bearer-auth'd via `COLLAB_INTERNAL_SECRET`). Self-host
   keeps calling the same underlying function from today's `setInterval` boot hook;
   Vercel wires Vercel Cron to the HTTP route. The domain logic doesn't know which
   platform is calling it.
3. **`RateLimiter` gets a Postgres-backed implementation** alongside the existing
   in-memory one (interface unchanged — it was already injectable). Selection is an
   explicit `COLLAB_RATELIMIT_STORE` env var, default `memory`. No platform
   auto-detection (e.g. sniffing `VERCEL=1`) in core code — a platform adapter may
   *choose* a default for itself, but `config.ts` never branches on which platform
   it's running on.
4. **`config.ts` is decomposed** from one monolithic `depsFromEnv()` into small
   per-resource builders (`dbFromEnv`, `storeFromEnv`, `urlsFromEnv`, `limitsFromEnv`,
   `githubFromEnv`, `mirrorFromEnv`); `depsFromEnv()` composes all of them for
   self-host. A platform adapter composes its own subset instead of layering
   overrides onto an opaque function — e.g. the Vercel adapter swaps in a
   pool-limited `db` and a `PostgresRateLimiter` and reuses every other builder
   as-is. `createDb()` gains an optional postgres-js options param (e.g. `max: 1`)
   so serverless pool sizing is a caller decision.
5. **Platform entry points are thin adapter files, not new workspace packages** —
   `packages/server/src/adapters/vercel.ts` wraps `hono/vercel` (already ships in
   the `hono` dependency). Adapters are the *only* place allowed to hardcode
   platform-specific behavior: the Vercel adapter forces `contentWildcard: true`
   (per-Site subdomain isolation, required once the deployment is multi-tenant —
   self-host keeps path-based as the default) and rejects
   `GITHUB_APP_PRIVATE_KEY_PATH` at boot with a clear error, since Vercel has no
   mountable secret-file volume the way Docker/Kubernetes self-hosts do — operators
   there use the inline `GITHUB_APP_PRIVATE_KEY` instead.

## Considered Options

- **A durable queue for outbound retry** (Vercel `waitUntil` + QStash, or
  SQS-with-delay) instead of poll-and-sweep. Rejected for now: the `comment_mirrors`
  table already carries the retry state the bus needs, dispatch failure volume is
  low, and reusing one drain mechanism for both inbound reconcile and outbound retry
  avoids adding a new operational dependency self-hosters don't otherwise need.
  Revisit if dispatch volume or latency requirements outgrow poll-and-sweep.
- **Auto-detecting the platform** (e.g. defaulting the rate limiter to Postgres when
  `VERCEL` is set) instead of explicit config. Rejected: it makes core behavior
  depend on a vendor-specific env var, and silently fails to protect a self-hosted
  multi-instance deployment that doesn't happen to set that var.

## Consequences

- Self-host behavior is unchanged by default: in-memory rate limiter, `setInterval`
  trigger, path-based content origin — none of this forces new operational
  complexity onto the common case.
- The hosted/Vercel target requires deliberate opt-in for every multi-instance-safe
  choice (Postgres rate limiter, wildcard content origin, pooled DB) rather than
  inheriting self-host defaults by accident.
- A future third platform (e.g. Cloudflare Workers, ADR-0011's original aspiration)
  is just another adapter composing the same builders, not a new special case in
  `config.ts`.
- Consumer-facing custom domains per Site (CONTEXT.md, Site: _Future_) stay additive
  on top of this — `contentBaseFor()` remains a pure function of slug + one content
  host today, and gains a per-Site override lookup later without disturbing this
  shape.

// Vercel adapter (M11, ADR-0015) — the hosted-target entry point alongside
// self-host's `index.ts`. Adapters are the only place allowed to hardcode
// platform-specific behavior:
//   - `contentWildcard: true` — per-Site subdomain isolation, required once the
//     deployment is genuinely multi-tenant (self-host keeps path-based).
//   - `PostgresRateLimiter` — the in-memory limiter is silently wrong across
//     the many concurrent Lambda instances a busy hosted Site gets.
//   - rejects `GITHUB_APP_PRIVATE_KEY_PATH` at boot — Vercel has no mountable
//     secret-file volume the way Docker/Kubernetes self-hosts do.
// Retry/reconcile has no persistent process to run a `setInterval` in; Vercel
// Cron calls `POST /internal/drain` instead (see `vercel.json`).
import { handle } from "hono/vercel";
import { createApp } from "../app.js";
import {
  dbFromEnv,
  storeFromEnv,
  urlsFromEnv,
  limitsFromEnv,
  githubFromEnv,
  mirrorFromEnv,
  internalSecretFromEnv,
  intEnv,
} from "../config.js";
import { NoopRateLimiter, PostgresRateLimiter, type RateLimiter } from "../rate-limit.js";
import type { Db } from "@collab/db";

if (process.env.GITHUB_APP_PRIVATE_KEY_PATH) {
  throw new Error(
    "GITHUB_APP_PRIVATE_KEY_PATH is not supported on Vercel (no mountable secret-file " +
      "volume) — set GITHUB_APP_PRIVATE_KEY to the inline PEM value instead.",
  );
}

// Forces Postgres regardless of `COLLAB_RATELIMIT_STORE` — multi-instance
// hosting makes the in-memory limiter silently wrong, not just a worse
// default, so this is a hard override rather than a tunable. Explicit
// `COLLAB_RATELIMIT_DISABLED` is still honored (a deliberate operator choice).
function rateLimiterForVercel(db: Db): RateLimiter {
  if (process.env.COLLAB_RATELIMIT_DISABLED === "true") return new NoopRateLimiter();
  const limit = intEnv("COLLAB_RATELIMIT_COMMENTS") ?? 20;
  const windowMs = intEnv("COLLAB_RATELIMIT_WINDOW_MS") ?? 60_000;
  return new PostgresRateLimiter(db, limit, windowMs);
}

// A serverless-function-sized pool (`max: 1`): each invocation gets its own
// connection rather than a pool sized for a persistent process.
const db = dbFromEnv({ max: 1 });
const store = storeFromEnv();
const urls = urlsFromEnv();
const limits = limitsFromEnv();
const github = githubFromEnv();
const { mirror, mirrorBus } = mirrorFromEnv({ db, store, github });

const app = createApp({
  db,
  store,
  ...urls,
  contentWildcard: true,
  rateLimiter: rateLimiterForVercel(db),
  limits,
  mirror,
  mirrorBus,
  github,
  internalSecret: internalSecretFromEnv(),
});

// `handle()` dispatches every HTTP method through Hono's own routing — a
// single default export covers GET/POST/PUT/PATCH/DELETE, no per-method
// exports needed (unlike Next.js App Router route handlers).
export default handle(app);

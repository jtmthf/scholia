// Per-Viewer/IP rate limiting on comment creation (PLAN §5 M9, CONTEXT "Site
// state": "applies regardless of state"). A small in-memory fixed-window counter
// keyed by an opaque string (the caller composes `${siteId}:${viewerId|ip}`).
//
// In-memory is sufficient for the self-host path (typically single-instance);
// it is injected via AppDeps so a multi-instance deployment can swap a shared
// implementation (M11: `PostgresRateLimiter`, ADR-0015) and tests can supply a
// NoopRateLimiter or a tiny window. This is a safety mechanism, so it is on by
// default (config.ts wires the default limit); operators tune or disable it via
// env (`SCHOLIA_RATELIMIT_STORE` selects the implementation).

import { hitRateLimit, type Db } from "@scholia/db";

export interface RateLimitResult {
  ok: boolean;
  /** Milliseconds until the window resets; set when `ok` is false. */
  retryAfterMs?: number;
}

export interface RateLimiter {
  /**
   * Record one hit for `key` and report whether it is within the limit.
   * Async to accommodate `PostgresRateLimiter` (M11); in-memory implementations
   * still return synchronously (a plain value satisfies a `Promise`-typed return).
   */
  hit(key: string): RateLimitResult | Promise<RateLimitResult>;
}

// Fixed-window limiter: at most `limit` hits per `windowMs` per key. A window
// starts on the first hit for a key and resets `windowMs` later. Stale windows
// are pruned lazily on access plus opportunistically to bound memory.
export class FixedWindowRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  hit(key: string): RateLimitResult {
    const now = Date.now();
    this.maybeSweep(now);

    const w = this.windows.get(key);
    if (!w || now >= w.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return { ok: true };
    }

    if (w.count >= this.limit) {
      return { ok: false, retryAfterMs: Math.max(0, w.resetAt - now) };
    }
    w.count += 1;
    return { ok: true };
  }

  // Drop expired windows at most once per windowMs so a burst of distinct keys
  // (many viewers/IPs) can't grow the map without bound.
  private maybeSweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [key, w] of this.windows) {
      if (now >= w.resetAt) this.windows.delete(key);
    }
  }
}

// No-op limiter: every hit passes. Used when rate limiting is disabled (env) and
// as a convenient default for tests that don't exercise the limit.
export class NoopRateLimiter implements RateLimiter {
  hit(_key: string): RateLimitResult {
    return { ok: true };
  }
}

// Postgres-backed fixed-window limiter (M11, ADR-0015): correct across the many
// concurrent instances a busy hosted Site gets (e.g. Vercel Lambdas), where the
// in-memory limiter's per-process Map would silently become `limit ×
// warm-instance-count`. One round trip per hit via `hitRateLimit`'s atomic
// upsert. Selected via `SCHOLIA_RATELIMIT_STORE=postgres`; the Vercel adapter
// defaults to it since multi-instance hosting requires it.
export class PostgresRateLimiter implements RateLimiter {
  constructor(
    private readonly db: Db,
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  async hit(key: string): Promise<RateLimitResult> {
    const { count, retryAfterMs } = await hitRateLimit(this.db, key, this.windowMs);
    if (count > this.limit) {
      // `retryAfterMs` comes back measured against the Postgres clock. Do not
      // recompute it from `resetAt` and `Date.now()` — that mixes two machines'
      // clocks and leaks their skew into the hint (see RateLimitHit, ADR-0035).
      return { ok: false, retryAfterMs };
    }
    return { ok: true };
  }
}

// Per-Viewer/IP rate limiting on comment creation (PLAN §5 M9, CONTEXT "Site
// state": "applies regardless of state"). A small in-memory fixed-window counter
// keyed by an opaque string (the caller composes `${siteId}:${viewerId|ip}`).
//
// In-memory is sufficient for v1 single-instance hosting and the self-host path;
// it is injected via AppDeps so a multi-instance deployment can swap a shared
// (e.g. Redis) implementation and tests can supply a NoopRateLimiter or a tiny
// window. This is a safety mechanism, so it is on by default (config.ts wires the
// default limit); operators tune or disable it via env.

export interface RateLimitResult {
  ok: boolean;
  /** Milliseconds until the window resets; set when `ok` is false. */
  retryAfterMs?: number;
}

export interface RateLimiter {
  /** Record one hit for `key` and report whether it is within the limit. */
  hit(key: string): RateLimitResult;
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

import { describe, test, expect, vi, afterEach } from "vitest";
import { FixedWindowRateLimiter, NoopRateLimiter } from "../src/rate-limit.js";

// Unit tests for the M9 comment-creation rate limiter. No DB needed.
describe("FixedWindowRateLimiter", () => {
  afterEach(() => vi.useRealTimers());

  test("allows up to the limit, then rejects with a retry hint", () => {
    const rl = new FixedWindowRateLimiter(3, 1000);
    expect(rl.hit("k").ok).toBe(true);
    expect(rl.hit("k").ok).toBe(true);
    expect(rl.hit("k").ok).toBe(true);
    const over = rl.hit("k");
    expect(over.ok).toBe(false);
    expect(over.retryAfterMs).toBeGreaterThan(0);
    expect(over.retryAfterMs).toBeLessThanOrEqual(1000);
  });

  test("keys are independent", () => {
    const rl = new FixedWindowRateLimiter(1, 1000);
    expect(rl.hit("a").ok).toBe(true);
    expect(rl.hit("a").ok).toBe(false);
    expect(rl.hit("b").ok).toBe(true); // different key, own window
  });

  test("window resets after windowMs", () => {
    vi.useFakeTimers();
    const rl = new FixedWindowRateLimiter(1, 1000);
    expect(rl.hit("k").ok).toBe(true);
    expect(rl.hit("k").ok).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(rl.hit("k").ok).toBe(true); // fresh window
  });
});

describe("NoopRateLimiter", () => {
  test("never limits", () => {
    const rl = new NoopRateLimiter();
    for (let i = 0; i < 100; i++) expect(rl.hit("k").ok).toBe(true);
  });
});

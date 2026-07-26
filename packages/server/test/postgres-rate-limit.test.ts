import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { schema, type Db } from "@scholia/db";
import { PostgresRateLimiter } from "../src/rate-limit.js";
import { migrateWithLock } from "./helpers/migrate.js";

// Integration test for the M11 Postgres-backed rate limiter (ADR-0015) — the
// multi-instance-safe alternative to the in-memory FixedWindowRateLimiter.
// Needs Postgres (DATABASE_URL); skips when unset.
const DB_URL = process.env.DATABASE_URL;
const MIGRATIONS = fileURLToPath(new URL("../../db/drizzle", import.meta.url));

describe.skipIf(!DB_URL)("PostgresRateLimiter", () => {
  let sql: ReturnType<typeof postgres>;
  let db: Db;

  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1 });
    db = drizzle(sql, { schema }) as unknown as Db;
    await migrateWithLock(sql, db as unknown as ReturnType<typeof drizzle>, MIGRATIONS);
  });

  afterAll(async () => {
    await sql?.end();
  });

  test("allows up to the limit, then rejects with a retry hint", async () => {
    const rl = new PostgresRateLimiter(db, 3, 60_000);
    const key = `test:${crypto.randomUUID()}`;
    expect((await rl.hit(key)).ok).toBe(true);
    expect((await rl.hit(key)).ok).toBe(true);
    expect((await rl.hit(key)).ok).toBe(true);
    const over = await rl.hit(key);
    expect(over.ok).toBe(false);
    expect(over.retryAfterMs).toBeGreaterThan(0);
    expect(over.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  test("keys are independent", async () => {
    const rl = new PostgresRateLimiter(db, 1, 60_000);
    const a = `test:${crypto.randomUUID()}`;
    const b = `test:${crypto.randomUUID()}`;
    expect((await rl.hit(a)).ok).toBe(true);
    expect((await rl.hit(a)).ok).toBe(false);
    expect((await rl.hit(b)).ok).toBe(true); // different key, own window
  });

  test("window resets after windowMs", async () => {
    const rl = new PostgresRateLimiter(db, 1, 50);
    const key = `test:${crypto.randomUUID()}`;
    expect((await rl.hit(key)).ok).toBe(true);
    expect((await rl.hit(key)).ok).toBe(false);
    await new Promise((r) => setTimeout(r, 75));
    expect((await rl.hit(key)).ok).toBe(true); // fresh window
  });

  test("concurrent hits on one key never exceed the limit", async () => {
    const rl = new PostgresRateLimiter(db, 5, 60_000);
    const key = `test:${crypto.randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 10 }, () => rl.hit(key)));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
  });
});

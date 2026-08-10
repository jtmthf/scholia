import { describe, test, expect, afterAll } from "vitest";
import postgres from "postgres";
import { createIsolatedTestDb } from "./harness.js";

// These tests exercise the hermetic test harness itself. The global setup
// preserves the original user-configured URL here so the helper can be tested
// against the base database, not the already-isolated one.
const BASE_URL = process.env.SCHOLIA_TEST_DATABASE_BASE_URL ?? process.env.DATABASE_URL;

describe("createIsolatedTestDb", () => {
  if (!BASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  let isolated: Awaited<ReturnType<typeof createIsolatedTestDb>>;

  afterAll(async () => {
    await isolated?.drop();
  });

  test("creates a fresh database with migrations applied", async () => {
    isolated = await createIsolatedTestDb(BASE_URL);

    // The returned URL must differ from the base URL and include the test DB name.
    expect(isolated.url).not.toBe(BASE_URL);
    expect(isolated.url).toMatch(/scholia_test_\d+_[a-z0-9]+$/);

    // Connect and verify the migrations table exists (migrations ran).
    const sql = postgres(isolated.url, { max: 1 });
    try {
      const [row] = await sql`SELECT COUNT(*) AS count FROM "drizzle"."__drizzle_migrations"`;
      expect(row).toBeTruthy();
      expect(Number(row!.count)).toBeGreaterThan(0);
    } finally {
      await sql.end();
    }
  });

  test("drop() removes the database", async () => {
    const toDrop = await createIsolatedTestDb(BASE_URL);
    await toDrop.drop();

    // Connecting to the dropped database should fail.
    const sql = postgres(toDrop.url, { max: 1 });
    await expect(sql`SELECT 1`).rejects.toThrow();
    await sql.end({ timeout: 0 });
  });
});

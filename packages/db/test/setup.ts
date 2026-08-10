import { createIsolatedTestDb } from "./harness.js";

// Vitest globalSetup. Creates a fresh Postgres database for this test run,
// migrates it, and points process.env.DATABASE_URL at it. Every DB-backed
// test file then connects to this isolated target. On teardown the database
// is dropped. A missing DATABASE_URL fails loudly instead of skipping.
//
// This file is referenced from the root vitest.config.ts.

export default async function setup() {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error(
      "DATABASE_URL is not set. " +
        "Integration tests require a Postgres database. " +
        "Run `docker compose up -d` and set DATABASE_URL " +
        "(e.g., postgres://scholia:scholia@127.0.0.1:5544/scholia).",
    );
  }

  const isolated = await createIsolatedTestDb(baseUrl);
  // Preserve the original user-configured URL so tests of the harness itself
  // can exercise the helper against the base database.
  process.env.SCHOLIA_TEST_DATABASE_BASE_URL = baseUrl;
  process.env.DATABASE_URL = isolated.url;

  return async function teardown() {
    await isolated.drop();
  };
}

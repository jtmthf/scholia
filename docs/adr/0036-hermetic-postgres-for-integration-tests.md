# Hermetic Postgres for integration tests

Integration tests in `packages/server/test/` all connected to the same long-lived `scholia` Postgres database and left their rows behind. That made tests order- and history-dependent, hid a real product bug behind apparently flaky failures (#40), and let a dev DB accumulate 130+ Sites. We decided to give every vitest invocation its own isolated database target, make a missing `DATABASE_URL` fail loudly, and provide the seam as a workspace-wide harness rather than a server-only patch.

## Decision

- Each vitest run creates a fresh Postgres database (preferred) or schema, migrates it, runs the tests against it, and drops it on exit.
- Tests no longer skip silently when `DATABASE_URL` is unset. A missing or invalid URL fails the run immediately with a clear message.
- The isolation harness lives in a shared location (e.g., `packages/db/` or a root test utility) so any workspace package can opt into it.

## Considered options

- **Transaction-per-test with rollback** — fast, but would require threading the test transaction through `createApp()` and every code path; the current tests each open their own `postgres({ max: 1 })` connection. Rejected because it changes the app/test contract rather than just the harness.
- **Truncate-between-files fixture** — simpler to add, but still shares state within a file, slows down as tables grow, and races under parallel workers. Rejected because it is not true isolation.
- **Per-run schema/database** — true hermeticity at the run boundary, no per-test code changes, and matches the existing connection model. Chosen despite requiring `CREATE`/`DROP` privileges and crash-safe cleanup.

## Consequences

- A fresh run is a fresh database; previous runs cannot interfere.
- Local `pnpm test` without `DATABASE_URL` will now fail instead of appearing green, closing the silent-skip trap documented in `AGENTS.md`.
- Future DB-backed packages can reuse the same harness instead of re-inventing isolation.
- CI and local setup must grant the test user permission to create and drop databases/schemas.

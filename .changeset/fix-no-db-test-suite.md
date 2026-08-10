---
"scholia": patch
---

Fix the no-DB test script so it runs without Postgres. Vitest is now configured with `no-db` and `db` projects; `pnpm test:no-db` runs only the `no-db` project, which excludes the per-run database global setup, restoring the CI check on runners that have no database.

import { migrate } from "drizzle-orm/postgres-js/migrator";
import type postgres from "postgres";

// A fixed, arbitrary advisory-lock key shared by every DB integration file.
const MIGRATION_LOCK = 727274;

// Apply drizzle migrations, serialized across parallel vitest workers via a
// Postgres advisory lock. vitest runs test files in separate worker processes;
// each DB integration file migrates in its beforeAll, so without this two of
// them can race to apply a pending migration and one fails ("column … already
// exists"). pg_advisory_lock is database-global across sessions, so the second
// worker blocks until the first finishes, then migrate() sees nothing pending.
export async function migrateWithLock(
  sql: ReturnType<typeof postgres>,
  db: Parameters<typeof migrate>[0],
  migrationsFolder: string,
): Promise<void> {
  await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK})`;
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK})`;
  }
}

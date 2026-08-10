import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import * as schema from "../src/schema.js";

const MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));

export interface IsolatedTestDb {
  url: string;
  drop(): Promise<void>;
}

// Parse a Postgres URL and return a connection URL for the maintenance
// database (used to CREATE/DROP other databases). We use the `postgres`
// system database as the maintenance target.
function maintenanceUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = "/postgres";
  return url.toString();
}

function uniqueDbName(): string {
  return `scholia_test_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// Create a fresh Postgres database, migrate it, and return its URL plus a
// drop() function. The caller must invoke drop() to clean up.
export async function createIsolatedTestDb(baseUrl: string): Promise<IsolatedTestDb> {
  const dbName = uniqueDbName();
  const maintenance = maintenanceUrl(baseUrl);

  const adminSql = postgres(maintenance, { max: 1 });
  try {
    await adminSql`CREATE DATABASE ${adminSql(dbName)}`;
  } finally {
    await adminSql.end();
  }

  const isolatedUrl = new URL(baseUrl);
  isolatedUrl.pathname = `/${dbName}`;
  const url = isolatedUrl.toString();

  const sql = postgres(url, { max: 1 });
  try {
    const db = drizzle(sql, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
  } finally {
    await sql.end();
  }

  return {
    url,
    async drop() {
      const dropSql = postgres(maintenance, { max: 1 });
      try {
        await dropSql`DROP DATABASE IF EXISTS ${dropSql(dbName)}`;
      } finally {
        await dropSql.end();
      }
    },
  };
}

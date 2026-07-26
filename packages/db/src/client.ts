import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>;

// Open a Drizzle client over a postgres-js connection. The caller owns the
// lifecycle; pass the same url the migrations ran against. `options` passes
// through to postgres-js (e.g. `{ max: 1 }` for a serverless-function-sized
// pool — ADR-0015); self-host callers omit it and get postgres-js's defaults.
export function createDb(
  url = process.env.DATABASE_URL,
  options?: postgres.Options<Record<string, never>>,
) {
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  const client = postgres(url, options);
  return drizzle(client, { schema });
}

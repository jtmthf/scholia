import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>;

// Open a Drizzle client over a postgres-js connection. The caller owns the
// lifecycle; pass the same url the migrations ran against.
export function createDb(url = process.env.DATABASE_URL) {
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  const client = postgres(url);
  return drizzle(client, { schema });
}

// Build a `MirrorContext` for a provider's `dispatch`: resolves a manifest entry
// (path/kind/hashes) for a (versionId, pagePath) and fetches the canonical source
// bytes from the blob store. The provider uses this to map an Anchor's source
// range to a line range in the Page at the comment's bound Version.

import { schema } from "@scholia/db";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import type { BlobStore, MirrorContext } from "@scholia/core";

interface AppDepsLike {
  // `db` here is the raw Drizzle client (same shape `@scholia/db`'s createDb returns).
  db: unknown;
  store: BlobStore;
}

export function buildMirrorContext(deps: AppDepsLike): MirrorContext {
  return {
    async getManifestEntry(versionId, pagePath) {
      const db = deps.db as ReturnType<typeof drizzle>;
      const [row] = await db
        .select({
          path: schema.manifestEntries.path,
          kind: schema.manifestEntries.kind,
          contentHash: schema.manifestEntries.contentHash,
          renderedHash: schema.manifestEntries.renderedHash,
          sourceMapHash: schema.manifestEntries.sourceMapHash,
        })
        .from(schema.manifestEntries)
        .where(
          and(
            eq(schema.manifestEntries.versionId, versionId),
            eq(schema.manifestEntries.path, pagePath),
          ),
        )
        .limit(1);
      if (!row) return null;
      return {
        path: row.path,
        kind: row.kind as "markdown" | "html" | "asset",
        contentHash: row.contentHash,
        renderedHash: row.renderedHash,
        sourceMapHash: row.sourceMapHash,
      };
    },
    async getSource(contentHash) {
      return deps.store.get(contentHash);
    },
  };
}
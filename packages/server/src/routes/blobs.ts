import { Hono } from "hono";
import { hashBytes, isValidHash } from "@collab/core";
import type { AppDeps } from "../config.js";

// Blob negotiation endpoints (PLAN §5 M3). The client calls POST /blobs/diff
// first to learn which blobs the server is missing, then PUT each one before
// POST /sites. Unauthenticated in M3 (auth is a later milestone).
export function blobsRoutes(getDeps: () => AppDeps) {
  const app = new Hono();

  // Which of these content hashes does the store NOT already have?
  app.post("/blobs/diff", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { hashes?: unknown } | null;
    if (!body || !Array.isArray(body.hashes) || !body.hashes.every((h) => typeof h === "string")) {
      return c.json({ error: "expected JSON { hashes: string[] }" }, 400);
    }

    const { store } = getDeps();
    const results = await Promise.all(
      (body.hashes as string[]).map(async (hash) => ({ hash, has: await store.has(hash) })),
    );
    return c.json({ missing: results.filter((r) => !r.has).map((r) => r.hash) });
  });

  // Store a single blob; verify its sha256 equals the :hash path param.
  app.put("/blobs/:hash", async (c) => {
    const hash = c.req.param("hash");
    if (!isValidHash(hash)) return c.json({ error: "invalid hash" }, 400);

    const { store } = getDeps();
    const existed = await store.has(hash);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const actual = hashBytes(bytes);
    if (actual !== hash) {
      return c.json({ error: "hash mismatch", expected: hash, got: actual }, 400);
    }

    await store.put(bytes);
    return c.json({ hash, size: bytes.length, existed });
  });

  return app;
}

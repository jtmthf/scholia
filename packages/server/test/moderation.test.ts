import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { schema, type Db } from "@scholia/db";
import { FsBlobStore, hashBytes } from "@scholia/core";
import { createApp } from "../src/app.js";
import { FixedWindowRateLimiter, NoopRateLimiter } from "../src/rate-limit.js";
import type { InputDeps } from "../src/app.js";
import { migrateWithLock } from "./helpers/migrate.js";

// Integration test for M9: moderation & ops (Site state, owner delete, Share URL
// + owner token rotation, token revoke, upload caps, comment rate limiting).
// Mirrors the M3/M5 harness — needs a Postgres (DATABASE_URL); FsBlobStore in a
// temp dir. Skips when no DATABASE_URL is configured.
const DB_URL = process.env.DATABASE_URL;
const MIGRATIONS = fileURLToPath(new URL("../../db/drizzle", import.meta.url));

const enc = new TextEncoder();
const README_MD = "# Hello M9\n\nA paragraph about **moderation** in scholia.\n";

describe.skipIf(!DB_URL)("M9: Moderation & ops", () => {
  let sql: ReturnType<typeof postgres>;
  let db: Db;
  let app: ReturnType<typeof createApp>;
  let blobDir: string;

  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1 });
    db = drizzle(sql, { schema });
    await migrateWithLock(sql, db, MIGRATIONS);
    blobDir = await mkdtemp(join(tmpdir(), "scholia-blobs-m9-"));
    // Default app: no upload caps, a no-op limiter so the moderation tests aren't
    // throttled. Rate limiting + caps are exercised via bespoke apps below.
    app = createApp({
      db,
      store: new FsBlobStore(blobDir),
      publicUrl: "http://content.test",
      viewerUrl: "http://viewer.test",
      rateLimiter: new NoopRateLimiter(),
    });
  });

  afterAll(async () => {
    await sql?.end();
    if (blobDir) await rm(blobDir, { recursive: true, force: true });
  });

  const json = (path: string, method: string, body?: unknown, token?: string) =>
    app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  // Create a single-Markdown-Page Site; returns its slug + owner token.
  async function makeSite(app_ = app): Promise<{ slug: string; token: string }> {
    const bytes = enc.encode(README_MD);
    const hash = hashBytes(bytes);
    const diff = await app_.request("/blobs/diff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hashes: [hash] }),
    });
    const { missing } = (await diff.json()) as { missing: string[] };
    for (const h of missing) {
      await app_.request(`/blobs/${h}`, { method: "PUT", body: bytes.buffer });
    }
    const res = await app_.request("/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contentSource: { kind: "local" },
        files: [{ path: "README.md", kind: "markdown", contentHash: hash }],
      }),
    });
    return (await res.json()) as { slug: string; token: string };
  }

  async function mintViewer(slug: string): Promise<string> {
    const res = await json(`/sites/${slug}/viewers`, "POST");
    return ((await res.json()) as { viewerId: string }).viewerId;
  }

  const newThread = (slug: string, viewerId: string, body = "hi") =>
    json(`/sites/${slug}/conversations`, "POST", {
      pagePath: "README.md",
      body,
      viewerId,
      displayName: "Jane",
    });

  // ---- Site state (CONTEXT "Site state") ----

  test("owner sets state; read_only blocks public comments but allows Chats", async () => {
    const { slug, token } = await makeSite();
    const viewerId = await mintViewer(slug);

    // Non-owner cannot change state.
    expect((await json(`/sites/${slug}/state`, "PATCH", { state: "read_only" })).status).toBe(401);

    // Owner → read_only.
    const set = await json(`/sites/${slug}/state`, "PATCH", { state: "read_only" }, token);
    expect(set.status).toBe(200);
    expect((await set.json()).state).toBe("read_only");
    // Reflected in Site metadata.
    expect((await (await app.request(`/sites/${slug}`)).json()).state).toBe("read_only");

    // Public commenting disabled…
    expect((await newThread(slug, viewerId)).status).toBe(403);
    // …but a private Chat (the Viewer's own workspace) is still allowed.
    const chat = await json(`/sites/${slug}/conversations`, "POST", {
      pagePath: "README.md",
      body: "private note",
      viewerId,
      displayName: "Jane",
      visibility: "private",
    });
    expect(chat.status).toBe(201);
  });

  test("frozen locks public react + resolve; open restores commenting", async () => {
    const { slug, token } = await makeSite();
    const viewerId = await mintViewer(slug);
    // A public Thread created while open.
    const conv =
      (await newThread(slug, viewerId)).status === 201
        ? await (await newThread(slug, viewerId, "seed")).json()
        : null;
    expect(conv).toBeTruthy();
    const commentId = conv.comments[0].id;

    await json(`/sites/${slug}/state`, "PATCH", { state: "frozen" }, token);

    // All public mutations blocked while frozen.
    expect((await newThread(slug, viewerId)).status).toBe(403);
    const react = await json(`/sites/${slug}/comments/${commentId}/reactions`, "POST", {
      emoji: "👍",
      viewerId,
      displayName: "Jane",
    });
    expect(react.status).toBe(403);
    const resolve = await json(`/sites/${slug}/conversations/${conv.id}/resolve`, "POST", {
      viewerId,
      displayName: "Jane",
    });
    expect(resolve.status).toBe(403);

    // Back to open → commenting works again.
    await json(`/sites/${slug}/state`, "PATCH", { state: "open" }, token);
    expect((await newThread(slug, viewerId)).status).toBe(201);
  });

  test("rejects an invalid state value", async () => {
    const { slug, token } = await makeSite();
    expect((await json(`/sites/${slug}/state`, "PATCH", { state: "nope" }, token)).status).toBe(
      400,
    );
  });

  // ---- Owner delete (Conversation + Site) ----

  test("owner deletes any Conversation; non-owner cannot", async () => {
    const { slug, token } = await makeSite();
    const viewerId = await mintViewer(slug);
    const conv = await (await newThread(slug, viewerId)).json();

    // Non-owner (no token) → 401.
    expect((await json(`/sites/${slug}/conversations/${conv.id}`, "DELETE")).status).toBe(401);

    const del = await json(`/sites/${slug}/conversations/${conv.id}`, "DELETE", undefined, token);
    expect(del.status).toBe(204);

    // Gone from the page listing.
    const listed = await (await app.request(`/sites/${slug}/conversations?path=README.md`)).json();
    expect(listed).toHaveLength(0);
    // Deleting again → 404.
    expect(
      (await json(`/sites/${slug}/conversations/${conv.id}`, "DELETE", undefined, token)).status,
    ).toBe(404);
  });

  test("owner deletes the whole Site", async () => {
    const { slug, token } = await makeSite();
    expect((await json(`/sites/${slug}`, "DELETE")).status).toBe(401); // needs owner
    const del = await json(`/sites/${slug}`, "DELETE", undefined, token);
    expect(del.status).toBe(204);
    expect((await app.request(`/sites/${slug}`)).status).toBe(404);
  });

  // ---- Share URL + owner token rotation ----

  test("rotate-share mints a new slug; the old link 404s", async () => {
    const { slug, token } = await makeSite();
    const res = await json(`/sites/${slug}/rotate-share`, "POST", undefined, token);
    expect(res.status).toBe(200);
    const { slug: newSlug, shareUrl } = await res.json();
    expect(newSlug).not.toBe(slug);
    expect(shareUrl).toBe(`http://viewer.test/s/${newSlug}`);
    expect((await app.request(`/sites/${slug}`)).status).toBe(404);
    expect((await app.request(`/sites/${newSlug}`)).status).toBe(200);
  });

  test("rotate-token issues a new token and revokes the old", async () => {
    const { slug, token } = await makeSite();
    const res = await json(`/sites/${slug}/rotate-token`, "POST", undefined, token);
    expect(res.status).toBe(200);
    const { token: newToken } = await res.json();
    expect(newToken).not.toBe(token);

    // Old token no longer authorizes an owner action.
    expect((await json(`/sites/${slug}/state`, "PATCH", { state: "frozen" }, token)).status).toBe(
      403,
    );
    // New token does.
    expect(
      (await json(`/sites/${slug}/state`, "PATCH", { state: "frozen" }, newToken)).status,
    ).toBe(200);
  });

  // ---- Token list + revoke ----

  test("list tokens; revoke a viewer token; refuse the last owner token", async () => {
    const { slug, token } = await makeSite();
    const viewerId = await mintViewer(slug);
    // Mint a viewer-scoped agent token.
    const vt = await json(`/sites/${slug}/viewers/${viewerId}/agent-token`, "POST");
    expect(vt.status).toBe(201);

    const list = await (await json(`/sites/${slug}/tokens`, "GET", undefined, token)).json();
    const owner = list.tokens.find((t: any) => t.kind === "owner");
    const viewer = list.tokens.find((t: any) => t.kind === "viewer");
    expect(owner).toBeTruthy();
    expect(viewer).toBeTruthy();
    // Never leaks a secret.
    expect(JSON.stringify(list)).not.toContain(token);

    // Revoke the viewer token → 204.
    expect(
      (await json(`/sites/${slug}/tokens/${viewer.id}`, "DELETE", undefined, token)).status,
    ).toBe(204);
    // The last live owner token cannot be revoked → 409.
    expect(
      (await json(`/sites/${slug}/tokens/${owner.id}`, "DELETE", undefined, token)).status,
    ).toBe(409);
  });

  // ---- Upload caps (operator retention/quota, default-unset) ----

  test("file-count cap rejects an over-limit upload with 413", async () => {
    const capped = createApp({
      db,
      store: new FsBlobStore(blobDir),
      publicUrl: "http://content.test",
      viewerUrl: "http://viewer.test",
      rateLimiter: new NoopRateLimiter(),
      limits: { maxFileCount: 1 },
    });
    const a = enc.encode("# A\n");
    const b = enc.encode("# B\n");
    for (const bytes of [a, b]) {
      await capped.request(`/blobs/${hashBytes(bytes)}`, { method: "PUT", body: bytes.buffer });
    }
    const res = await capped.request("/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contentSource: { kind: "local" },
        files: [
          { path: "a.md", kind: "markdown", contentHash: hashBytes(a) },
          { path: "b.md", kind: "markdown", contentHash: hashBytes(b) },
        ],
      }),
    });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/too many files/);
  });

  test("per-file byte cap rejects an oversize blob at PUT with 413", async () => {
    const capped = createApp({
      db,
      store: new FsBlobStore(blobDir),
      publicUrl: "http://content.test",
      viewerUrl: "http://viewer.test",
      rateLimiter: new NoopRateLimiter(),
      limits: { maxFileBytes: 8 },
    } satisfies InputDeps);
    const big = enc.encode("this is more than eight bytes");
    const res = await capped.request(`/blobs/${hashBytes(big)}`, {
      method: "PUT",
      body: big.buffer,
    });
    expect(res.status).toBe(413);
  });

  // ---- Rate limiting (applies regardless of state) ----

  test("comment creation is rate-limited per viewer with 429 + Retry-After", async () => {
    const limited = createApp({
      db,
      store: new FsBlobStore(blobDir),
      publicUrl: "http://content.test",
      viewerUrl: "http://viewer.test",
      rateLimiter: new FixedWindowRateLimiter(2, 60_000),
    });
    const { slug, token: _t } = await makeSite(limited);
    const viewerId = await (async () => {
      const r = await limited.request(`/sites/${slug}/viewers`, { method: "POST" });
      return ((await r.json()) as { viewerId: string }).viewerId;
    })();

    const post = () =>
      limited.request(`/sites/${slug}/conversations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pagePath: "README.md",
          body: "spam",
          viewerId,
          displayName: "Jane",
        }),
      });

    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(201);
    const third = await post();
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBeTruthy();
  });
});

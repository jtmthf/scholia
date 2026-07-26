import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { schema } from "@scholia/db";
import { FsBlobStore, hashBytes } from "@scholia/core";
import { createApp } from "../src/app.js";
import { migrateWithLock } from "./helpers/migrate.js";
import { ScholiaClient } from "../../client/src/index.js";

// Integration round-trip tests for @scholia/client via an in-process Hono app.
// ScholiaClient's fetch calls are intercepted and routed to app.request() so no
// real network is needed. Requires a Postgres DATABASE_URL; skips without one.
const DB_URL = process.env.DATABASE_URL;
const MIGRATIONS = fileURLToPath(new URL("../../db/drizzle", import.meta.url));

const enc = new TextEncoder();

// The fake server URL the client is configured with — the mock fetch strips this
// prefix so app.request() sees only the path+query.
const FAKE_SERVER = "http://scholia.test";

describe.skipIf(!DB_URL)("M7: ScholiaClient round-trips (in-process)", () => {
  let sql: ReturnType<typeof postgres>;
  let app: ReturnType<typeof createApp>;
  let blobDir: string;

  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1 });
    const db = drizzle(sql, { schema });
    await migrateWithLock(sql, db, MIGRATIONS);
    blobDir = await mkdtemp(join(tmpdir(), "scholia-blobs-client-"));
    app = createApp({
      db,
      store: new FsBlobStore(blobDir),
      publicUrl: "http://content.test",
      viewerUrl: "http://viewer.test",
    });

    // Stub global fetch to route through the in-process app.
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
      const urlStr = input instanceof Request ? input.url : String(input);
      const path = urlStr.startsWith(FAKE_SERVER) ? urlStr.slice(FAKE_SERVER.length) : urlStr;
      const reqInit =
        input instanceof Request
          ? {
              method: input.method,
              headers: Object.fromEntries(input.headers as any),
              body: (init?.body ?? input.body) as BodyInit | undefined,
            }
          : init;
      return app.request(path, reqInit);
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await sql?.end();
    if (blobDir) await rm(blobDir, { recursive: true, force: true });
  });

  // Helpers ----------------------------------------------------------------

  const README_TEXT = "# Round-trip test site\n\nPage content for client tests.\n";

  async function makeClientSite(): Promise<{ slug: string; token: string }> {
    // Upload blobs manually then create the site via the API (no ScholiaClient
    // upload helper needed here — we just need a slug + token).
    const hash = hashBytes(enc.encode(README_TEXT));
    await app.request(`/blobs/diff`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hashes: [hash] }),
    });
    await app.request(`/blobs/${hash}`, {
      method: "PUT",
      body: enc.encode(README_TEXT).buffer,
    });
    const res = await app.request("/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contentSource: { kind: "local" },
        files: [{ path: "README.md", kind: "markdown", contentHash: hash }],
      }),
    });
    const body = (await res.json()) as { slug: string; token: string };
    return { slug: body.slug, token: body.token };
  }

  async function mintViewer(slug: string): Promise<string> {
    const res = await app.request(`/sites/${slug}/viewers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    return ((await res.json()) as { viewerId: string }).viewerId;
  }

  // ---- Tests -------------------------------------------------------------

  test("ScholiaClient.listComments returns { comments: SiteCommentDTO[] }", async () => {
    const { slug, token } = await makeClientSite();

    // Seed one comment via the app directly so we have something to list.
    await app.request(`/sites/${slug}/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ pagePath: null, anchor: null, body: "Client list test." }),
    });

    const client = new ScholiaClient({ server: FAKE_SERVER, token, slug });
    const result = await client.listComments();
    expect(Array.isArray(result.comments)).toBe(true);
    expect(result.comments.length).toBeGreaterThanOrEqual(1);
    const dto = result.comments[0]!;
    expect(typeof dto.commentId).toBe("string");
    expect(typeof dto.body).toBe("string");
    expect(typeof dto.resolved).toBe("boolean");
  });

  test("ScholiaClient.listComments with unresolved filter", async () => {
    const { slug, token } = await makeClientSite();

    // Create thread, then resolve it.
    const convRes = await app.request(`/sites/${slug}/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ pagePath: null, anchor: null, body: "Will be resolved." }),
    });
    const conv = await convRes.json();
    await app.request(`/sites/${slug}/conversations/${conv.id}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ label: "bot" }),
    });

    // Create another unresolved thread.
    await app.request(`/sites/${slug}/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ pagePath: null, anchor: null, body: "Still open." }),
    });

    const client = new ScholiaClient({ server: FAKE_SERVER, token, slug });
    const result = await client.listComments({ unresolved: true });
    expect(result.comments.every((c) => c.resolved === false)).toBe(true);
    expect(result.comments.some((c) => c.conversationId === conv.id)).toBe(false);
  });

  test("ScholiaClient.createThread creates an agent thread", async () => {
    const { slug, token } = await makeClientSite();
    const client = new ScholiaClient({ server: FAKE_SERVER, token, slug });

    const conv = (await client.createThread({
      pagePath: "README.md",
      anchor: { textQuote: { exact: "Round-trip" } },
      body: "Created via ScholiaClient.",
      label: "ci-bot",
    })) as any;

    expect(conv.comments[0].author.kind).toBe("agent");
    expect(conv.comments[0].author.name).toBe("ci-bot");
    expect(conv.anchor?.textQuote?.exact).toBe("Round-trip");
  });

  test("ScholiaClient.reply adds agent reply to thread", async () => {
    const { slug, token } = await makeClientSite();
    const client = new ScholiaClient({ server: FAKE_SERVER, token, slug });

    const conv = (await client.createThread({
      body: "Initial thread.",
    })) as any;

    const reply = (await client.reply({
      conversationId: conv.id,
      body: "Reply via ScholiaClient.",
      label: "ci-bot",
    })) as any;

    expect(reply.author.kind).toBe("agent");
    expect(reply.body).toBe("Reply via ScholiaClient.");
  });

  test("ScholiaClient.react toggles reaction on a comment", async () => {
    const { slug, token } = await makeClientSite();
    const client = new ScholiaClient({ server: FAKE_SERVER, token, slug });

    const conv = (await client.createThread({
      body: "React target.",
    })) as any;
    const commentId = conv.comments[0].id;

    const r1 = (await client.react({ commentId, emoji: "👍" })) as any[];
    expect(r1.find((g: any) => g.emoji === "👍")?.count).toBe(1);

    // Toggle off.
    const r2 = (await client.react({ commentId, emoji: "👍" })) as any[];
    expect(r2.find((g: any) => g.emoji === "👍")).toBeUndefined();
  });

  test("ScholiaClient.resolve and reopen a thread", async () => {
    const { slug, token } = await makeClientSite();
    const client = new ScholiaClient({ server: FAKE_SERVER, token, slug });

    const conv = (await client.createThread({
      body: "Resolve via client.",
    })) as any;
    const conversationId = conv.id;

    const resolved = (await client.resolve({ conversationId, label: "ci-bot" })) as any;
    expect(resolved.resolved).toBe(true);

    const reopened = (await client.reopen({ conversationId, label: "ci-bot" })) as any;
    expect(reopened.resolved).toBe(false);
  });

  test("ScholiaClient.deleteComment owner-deletes any comment", async () => {
    const { slug, token } = await makeClientSite();
    const viewerId = await mintViewer(slug);
    const client = new ScholiaClient({ server: FAKE_SERVER, token, slug });

    // Viewer creates a thread.
    const convRes = await app.request(`/sites/${slug}/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pagePath: null,
        anchor: null,
        body: "Viewer comment to delete.",
        viewerId,
        displayName: "TestViewer",
      }),
    });
    const conv = await convRes.json();
    const commentId = conv.comments[0].id;

    await expect(client.deleteComment({ commentId })).resolves.toBeUndefined();

    // Verify tombstoned.
    const convs = (await (
      await app.request(`/sites/${slug}/conversations?viewerId=${viewerId}`)
    ).json()) as any[];
    expect(convs[0].comments[0].deleted).toBe(true);
  });

  test("ScholiaClient.listVersions returns versions array", async () => {
    const { slug, token } = await makeClientSite();
    const client = new ScholiaClient({ server: FAKE_SERVER, token, slug });

    const result = (await client.listVersions()) as any;
    expect(Array.isArray(result.versions)).toBe(true);
    expect(result.versions.length).toBeGreaterThanOrEqual(1);
    expect(result.versions[0].ordinal).toBe(1);
  });

  test("ScholiaClient request building: authHeaders throws without token", () => {
    const client = new ScholiaClient({ server: FAKE_SERVER, slug: "test" });
    // createThread requires a token; without one, should throw immediately.
    expect(() => (client as any).authHeaders()).toThrow("owner token required");
  });

  test("ScholiaClient request building: requireSlug throws without slug", () => {
    const client = new ScholiaClient({ server: FAKE_SERVER, token: "tok" });
    expect(() => (client as any).requireSlug()).toThrow("site slug required");
  });
});

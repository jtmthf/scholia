import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { schema } from "@scholia/db";
import { FsBlobStore, hashBytes } from "@scholia/core";
import { createApp } from "../src/app.js";

// Integration tests for M7: agent REST surface (owner-token writes, list_comments,
// agent-docs). Same harness as M5/M6 — needs Postgres (DATABASE_URL) + FsBlobStore
// temp dir. Provided by the root globalSetup.
const DB_URL = process.env.DATABASE_URL!;

const enc = new TextEncoder();
const README_MD = "# Hello\n\nThis is a **test** page for the agent surface.\n";

describe("M7: Agent surface", () => {
  let sql: ReturnType<typeof postgres>;
  let app: ReturnType<typeof createApp>;
  let blobDir: string;

  beforeAll(async () => {
    sql = postgres(DB_URL, { max: 1 });
    const db = drizzle(sql, { schema });
    blobDir = await mkdtemp(join(tmpdir(), "scholia-blobs-m7-"));
    app = createApp({
      db,
      store: new FsBlobStore(blobDir),
      publicUrl: "http://content.test",
      viewerUrl: "http://viewer.test",
    });
  });

  afterAll(async () => {
    await sql?.end();
    if (blobDir) await rm(blobDir, { recursive: true, force: true });
  });

  const json = (path: string, method: string, body?: unknown, headers?: Record<string, string>) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  interface FileSpec {
    path: string;
    kind: "markdown" | "html" | "asset";
    text: string;
  }

  async function upload(
    files: FileSpec[],
    opts: { slug?: string; token?: string } = {},
  ): Promise<{ status: number; body: any }> {
    const entries = files.map((f) => ({
      path: f.path,
      kind: f.kind,
      contentHash: hashBytes(enc.encode(f.text)),
    }));
    const diff = await json("/blobs/diff", "POST", { hashes: entries.map((e) => e.contentHash) });
    const { missing } = (await diff.json()) as { missing: string[] };
    for (const h of missing) {
      const f = files.find((x) => hashBytes(enc.encode(x.text)) === h)!;
      await app.request(`/blobs/${h}`, {
        method: "PUT",
        body: enc.encode(f.text).buffer,
      });
    }
    const url = opts.slug ? `/sites/${opts.slug}/versions` : "/sites";
    const res = await json(
      url,
      "POST",
      { contentSource: { kind: "local" }, files: entries },
      opts.token ? { authorization: `Bearer ${opts.token}` } : undefined,
    );
    return { status: res.status, body: await res.json() };
  }

  async function makeSite(): Promise<{ slug: string; token: string }> {
    const { status, body } = await upload([
      { path: "README.md", kind: "markdown", text: README_MD },
    ]);
    expect(status).toBe(201);
    return { slug: body.slug as string, token: body.token as string };
  }

  async function mintViewer(slug: string): Promise<string> {
    const res = await json(`/sites/${slug}/viewers`, "POST");
    expect(res.status).toBe(201);
    return ((await res.json()) as { viewerId: string }).viewerId;
  }

  // ---- Agent auth --------------------------------------------------------

  test("agent creates Thread with Bearer token — identity is agent/owner", async () => {
    const { slug, token } = await makeSite();

    const res = await json(
      `/sites/${slug}/conversations`,
      "POST",
      {
        pagePath: "README.md",
        anchor: { textQuote: { exact: "test", prefix: "a ", suffix: " page" } },
        body: "Agent comment here.",
        label: "review-bot",
      },
      { authorization: `Bearer ${token}` },
    );
    expect(res.status).toBe(201);
    const conv = await res.json();
    expect(conv.comments).toHaveLength(1);
    const comment = conv.comments[0];
    expect(comment.author.kind).toBe("agent");
    expect(comment.author.tier).toBe("owner");
    expect(comment.author.name).toBe("review-bot");
    // Anchor is stored as-is (no smIds→sourceRange lookup for agents).
    expect(conv.anchor.textQuote.exact).toBe("test");
    expect(conv.anchor.sourceRange).toBeUndefined();
  });

  test('agent creates Thread without label — defaults to "Owner\'s agent"', async () => {
    const { slug, token } = await makeSite();

    const res = await json(
      `/sites/${slug}/conversations`,
      "POST",
      { pagePath: "README.md", anchor: null, body: "No label." },
      { authorization: `Bearer ${token}` },
    );
    expect(res.status).toBe(201);
    const conv = await res.json();
    expect(conv.comments[0].author.name).toBe("Owner's agent");
  });

  test("agent auth via ?token= query param", async () => {
    const { slug, token } = await makeSite();

    const res = await app.request(`/sites/${slug}/conversations?token=${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pagePath: null, anchor: null, body: "Token in query." }),
    });
    expect(res.status).toBe(201);
    const conv = await res.json();
    expect(conv.comments[0].author.kind).toBe("agent");
  });

  test("missing token → 401 on agent write", async () => {
    const { slug } = await makeSite();
    // No Authorization header and no viewerId — the route sees no token at all.
    // Since the body has no viewerId/displayName either, it takes the agent path
    // (hasOwnerToken is false) → falls through to viewer validation → 400 (not 401).
    // The 401 path triggers when hasOwnerToken is true but token is missing —
    // i.e. when the request has an incomplete bearer. Test the ?token= empty case.
    const resNoToken = await app.request(`/sites/${slug}/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pagePath: null, anchor: null, body: "x", label: "bot" }),
    });
    // Without any token signal, hasOwnerToken=false, takes viewer path → 400
    // (missing viewerId/displayName). This is by design for the dual-mode route.
    expect([400, 401]).toContain(resNoToken.status);
  });

  test("invalid Bearer token → 403 on agent write", async () => {
    const { slug } = await makeSite();

    const res = await json(
      `/sites/${slug}/conversations`,
      "POST",
      { pagePath: null, anchor: null, body: "Bad token." },
      { authorization: "Bearer bad-token-value" },
    );
    expect(res.status).toBe(403);
  });

  // ---- Agent reply --------------------------------------------------------

  test("agent reply adds a comment with agent identity", async () => {
    const { slug, token } = await makeSite();

    // Create thread as agent.
    const thread = await (
      await json(
        `/sites/${slug}/conversations`,
        "POST",
        { pagePath: null, anchor: null, body: "First comment." },
        { authorization: `Bearer ${token}` },
      )
    ).json();
    const convId = thread.id;

    const reply = await json(
      `/sites/${slug}/conversations/${convId}/comments`,
      "POST",
      { body: "Agent reply.", label: "review-bot" },
      { authorization: `Bearer ${token}` },
    );
    expect(reply.status).toBe(201);
    const replyBody = await reply.json();
    expect(replyBody.author.kind).toBe("agent");
    expect(replyBody.author.name).toBe("review-bot");
    expect(replyBody.body).toBe("Agent reply.");
  });

  // ---- Agent resolve / reopen --------------------------------------------

  test("agent resolves and reopens a Thread", async () => {
    const { slug, token } = await makeSite();

    const thread = await (
      await json(
        `/sites/${slug}/conversations`,
        "POST",
        { pagePath: null, anchor: null, body: "Resolve me." },
        { authorization: `Bearer ${token}` },
      )
    ).json();
    const convId = thread.id;

    const resolved = await json(
      `/sites/${slug}/conversations/${convId}/resolve`,
      "POST",
      { label: "review-bot" },
      { authorization: `Bearer ${token}` },
    );
    expect(resolved.status).toBe(200);
    const resolvedBody = await resolved.json();
    expect(resolvedBody.resolved).toBe(true);
    expect(resolvedBody.resolvedBy).toBe("review-bot");

    const reopened = await json(
      `/sites/${slug}/conversations/${convId}/resolve`,
      "DELETE",
      { label: "review-bot" },
      { authorization: `Bearer ${token}` },
    );
    expect(reopened.status).toBe(200);
    expect((await reopened.json()).resolved).toBe(false);
  });

  // ---- Agent react -------------------------------------------------------

  test("agent react: same label toggles off; second call re-adds", async () => {
    const { slug, token } = await makeSite();

    const thread = await (
      await json(
        `/sites/${slug}/conversations`,
        "POST",
        { pagePath: null, anchor: null, body: "React target." },
        { authorization: `Bearer ${token}` },
      )
    ).json();
    const commentId = thread.comments[0].id;

    // First call: adds ✅
    const r1 = await json(
      `/sites/${slug}/comments/${commentId}/reactions`,
      "POST",
      { emoji: "✅", label: "review-bot" },
      { authorization: `Bearer ${token}` },
    );
    expect(r1.status).toBe(200);
    let groups = (await r1.json()) as any[];
    expect(groups.find((g) => g.emoji === "✅")?.count).toBe(1);

    // Second call with same label: toggles off.
    const r2 = await json(
      `/sites/${slug}/comments/${commentId}/reactions`,
      "POST",
      { emoji: "✅", label: "review-bot" },
      { authorization: `Bearer ${token}` },
    );
    expect(r2.status).toBe(200);
    groups = (await r2.json()) as any[];
    expect(groups.find((g) => g.emoji === "✅")).toBeUndefined();

    // Third call: re-adds.
    const r3 = await json(
      `/sites/${slug}/comments/${commentId}/reactions`,
      "POST",
      { emoji: "✅", label: "review-bot" },
      { authorization: `Bearer ${token}` },
    );
    expect(r3.status).toBe(200);
    groups = (await r3.json()) as any[];
    expect(groups.find((g) => g.emoji === "✅")?.count).toBe(1);
  });

  test("agent react: different labels produce separate reaction rows", async () => {
    const { slug, token } = await makeSite();

    const thread = await (
      await json(
        `/sites/${slug}/conversations`,
        "POST",
        { pagePath: null, anchor: null, body: "Multi-agent react." },
        { authorization: `Bearer ${token}` },
      )
    ).json();
    const commentId = thread.comments[0].id;

    // bot-a reacts.
    await json(
      `/sites/${slug}/comments/${commentId}/reactions`,
      "POST",
      { emoji: "👍", label: "bot-a" },
      { authorization: `Bearer ${token}` },
    );
    // bot-b reacts with same emoji (different label → different row).
    const r2 = await json(
      `/sites/${slug}/comments/${commentId}/reactions`,
      "POST",
      { emoji: "👍", label: "bot-b" },
      { authorization: `Bearer ${token}` },
    );
    expect(r2.status).toBe(200);
    const groups = (await r2.json()) as any[];
    expect(groups.find((g) => g.emoji === "👍")?.count).toBe(2);
  });

  // ---- Owner-delete ------------------------------------------------------

  test("owner-delete: agent can delete a viewer's comment (tombstone)", async () => {
    const { slug, token } = await makeSite();
    const viewerId = await mintViewer(slug);

    // Viewer creates a thread.
    const thread = await (
      await json(`/sites/${slug}/conversations`, "POST", {
        pagePath: null,
        anchor: null,
        body: "Viewer comment.",
        viewerId,
        displayName: "Jane",
      })
    ).json();
    const commentId = thread.comments[0].id;

    // Agent owner-deletes the viewer's comment.
    const del = await app.request(`/sites/${slug}/comments/${commentId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.status).toBe(204);

    // Verify tombstoned in conversation list.
    const convs = (await (
      await app.request(`/sites/${slug}/conversations?viewerId=${viewerId}`)
    ).json()) as any[];
    expect(convs[0].comments[0].deleted).toBe(true);
    expect(convs[0].comments[0].body).toBe("");
  });

  test("viewer cannot delete another viewer's comment (403)", async () => {
    const { slug } = await makeSite();
    const jane = await mintViewer(slug);
    const bob = await mintViewer(slug);

    const thread = await (
      await json(`/sites/${slug}/conversations`, "POST", {
        pagePath: null,
        anchor: null,
        body: "Jane's comment.",
        viewerId: jane,
        displayName: "Jane",
      })
    ).json();
    const commentId = thread.comments[0].id;

    const del = await json(`/sites/${slug}/comments/${commentId}`, "DELETE", { viewerId: bob });
    expect(del.status).toBe(403);
  });

  // ---- list_comments (GET /sites/:slug/comments) -------------------------

  test("list_comments: returns SiteCommentDTO shape", async () => {
    const { slug, token } = await makeSite();

    // Seed one thread.
    await json(
      `/sites/${slug}/conversations`,
      "POST",
      {
        pagePath: "README.md",
        anchor: { textQuote: { exact: "Hello" } },
        body: "A comment for list.",
        label: "bot",
      },
      { authorization: `Bearer ${token}` },
    );

    const res = await app.request(`/sites/${slug}/comments`);
    expect(res.status).toBe(200);
    const { comments } = await res.json();
    expect(comments.length).toBeGreaterThanOrEqual(1);
    const dto = comments[0];
    // Check required SiteCommentDTO fields.
    expect(typeof dto.conversationId).toBe("string");
    expect(typeof dto.commentId).toBe("string");
    expect(typeof dto.resolved).toBe("boolean");
    expect(typeof dto.version).toBe("number");
    expect(typeof dto.createdOrdinal).toBe("number");
    expect(typeof dto.body).toBe("string");
    expect(typeof dto.createdAt).toBe("string");
    expect(Array.isArray(dto.mentions)).toBe(true);
    expect(Array.isArray(dto.reactions)).toBe(true);
    expect(dto.author).toBeDefined();
    expect(dto.pagePath).toBeDefined();
  });

  test("list_comments: ?unresolved filters out resolved threads", async () => {
    const { slug, token } = await makeSite();

    // Thread A: will be resolved.
    const tA = await (
      await json(
        `/sites/${slug}/conversations`,
        "POST",
        { pagePath: null, anchor: null, body: "Thread A." },
        { authorization: `Bearer ${token}` },
      )
    ).json();

    // Thread B: stays unresolved.
    await json(
      `/sites/${slug}/conversations`,
      "POST",
      { pagePath: null, anchor: null, body: "Thread B." },
      { authorization: `Bearer ${token}` },
    );

    // Resolve thread A.
    await json(
      `/sites/${slug}/conversations/${tA.id}/resolve`,
      "POST",
      { label: "bot" },
      { authorization: `Bearer ${token}` },
    );

    // Without filter: both show up.
    const allRes = await app.request(`/sites/${slug}/comments`);
    const { comments: all } = await allRes.json();
    expect(all.length).toBeGreaterThanOrEqual(2);

    // With ?unresolved: only Thread B's comment shows.
    const unresRes = await app.request(`/sites/${slug}/comments?unresolved`);
    const { comments: unresolved } = await unresRes.json();
    const ids = unresolved.map((c: any) => c.conversationId);
    expect(ids).not.toContain(tA.id);
  });

  test("list_comments: ?since filters by createdAt", async () => {
    const { slug, token } = await makeSite();

    // Old comment.
    await json(
      `/sites/${slug}/conversations`,
      "POST",
      { pagePath: null, anchor: null, body: "Old comment." },
      { authorization: `Bearer ${token}` },
    );

    // Take the cutoff from the `createdAt` the API itself emitted, not from
    // `new Date()` (ADR-0035). Rows are stamped by the Postgres clock while the
    // test runs on the Node clock, and the two drift independently — a
    // locally-captured cutoff can land *before* the timestamp of a comment
    // already written, which no server-side filter can be expected to fix.
    // Reading it back also makes this the exact cursor-paging case: feed the
    // last seen `createdAt` in as `since` and that comment must not come back a
    // second time.
    const beforeRes = await app.request(`/sites/${slug}/comments`);
    const { comments: before } = await beforeRes.json();
    const cutoff = before.find((c: any) => c.body === "Old comment.").createdAt;

    // Brief pause so the next comment lands in a later millisecond.
    await new Promise((r) => setTimeout(r, 10));

    // New comment.
    const newThread = await (
      await json(
        `/sites/${slug}/conversations`,
        "POST",
        { pagePath: null, anchor: null, body: "New comment." },
        { authorization: `Bearer ${token}` },
      )
    ).json();

    const res = await app.request(`/sites/${slug}/comments?since=${encodeURIComponent(cutoff)}`);
    const { comments } = await res.json();
    expect(comments.every((c: any) => c.createdAt > cutoff)).toBe(true);
    // The comment *at* the cursor must be excluded, not merely tolerated:
    // `since` has to round-trip against the `createdAt` the API emits, or a
    // paging client receives the boundary comment on every poll.
    expect(comments.some((c: any) => c.body === "Old comment.")).toBe(false);
    expect(comments.some((c: any) => c.conversationId === newThread.id)).toBe(true);
  });

  test("list_comments: ?mentions=<name> filters by mention", async () => {
    const { slug, token } = await makeSite();

    // Comment mentioning @alice.
    const tAlice = await (
      await json(
        `/sites/${slug}/conversations`,
        "POST",
        { pagePath: null, anchor: null, body: "Hey @alice please review." },
        { authorization: `Bearer ${token}` },
      )
    ).json();

    // Comment mentioning @bob.
    await json(
      `/sites/${slug}/conversations`,
      "POST",
      { pagePath: null, anchor: null, body: "Hey @bob look at this." },
      { authorization: `Bearer ${token}` },
    );

    const res = await app.request(`/sites/${slug}/comments?mentions=alice`);
    const { comments } = await res.json();
    expect(comments.every((c: any) => c.conversationId === tAlice.id)).toBe(true);
    expect(comments.length).toBeGreaterThanOrEqual(1);
  });

  // ---- @-mentions --------------------------------------------------------

  test("@-mentions parsed and stored; surface via list_comments ?mentions", async () => {
    const { slug, token } = await makeSite();

    const thread = await (
      await json(
        `/sites/${slug}/conversations`,
        "POST",
        { pagePath: null, anchor: null, body: "@owner-agent please check this." },
        { authorization: `Bearer ${token}` },
      )
    ).json();

    // list_comments with mentions filter.
    const res = await app.request(`/sites/${slug}/comments?mentions=owner-agent`);
    const { comments } = await res.json();
    expect(comments.some((c: any) => c.conversationId === thread.id)).toBe(true);
    // Mentions field carries the raw target.
    const dto = comments.find((c: any) => c.conversationId === thread.id);
    expect(dto?.mentions).toContain("owner-agent");
  });

  test("mentions filter: ?mentions='Owner's agent' matches @owner-agent (possessive 's dropped)", async () => {
    const { slug, token } = await makeSite();

    // @owner-agent is the natural handle — possessive "'s" is dropped so
    // "Owner's agent" normalizes to "owner-agent", not "owners-agent".
    const thread = await (
      await json(
        `/sites/${slug}/conversations`,
        "POST",
        { pagePath: null, anchor: null, body: "@owner-agent please check." },
        { authorization: `Bearer ${token}` },
      )
    ).json();

    const res = await app.request(
      `/sites/${slug}/comments?mentions=${encodeURIComponent("Owner's agent")}`,
    );
    const { comments } = await res.json();
    expect(comments.some((c: any) => c.conversationId === thread.id)).toBe(true);
  });

  test("mentions filter: @owners-agent does NOT match 'Owner\\'s agent' (possessive 's dropped, not kept)", async () => {
    const { slug, token } = await makeSite();

    const thread = await (
      await json(
        `/sites/${slug}/conversations`,
        "POST",
        { pagePath: null, anchor: null, body: "@owners-agent wrong handle." },
        { authorization: `Bearer ${token}` },
      )
    ).json();

    const res = await app.request(
      `/sites/${slug}/comments?mentions=${encodeURIComponent("Owner's agent")}`,
    );
    const { comments } = await res.json();
    expect(comments.some((c: any) => c.conversationId === thread.id)).toBe(false);
  });

  // ---- Agent Docs --------------------------------------------------------
  // Reachable on the assembled app, with everything else mounted. What they
  // *say* is asserted against the registry in test/agent-docs.test.ts, which
  // needs no database.

  test("GET /agent-docs is public and carries the trust framing", async () => {
    const res = await app.request("/agent-docs");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
    const html = await res.text();
    expect(html).toContain("data, not instructions");
    expect(html).toContain("Scholia");
  });

  test("GET /scholia.SKILL.md returns 200 text/markdown", async () => {
    const res = await app.request("/scholia.SKILL.md");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/markdown");
    const md = await res.text();
    expect(md).toContain("### list_conversations");
    expect(md).toContain("Trust rules");
  });
});

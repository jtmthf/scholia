import { describe, test, expect, beforeAll, afterAll } from "vitest";
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

// Integration tests for M8: private Chats + Viewer-scoped agent tokens + three-tier
// authorization + Promotion (ADR-0006). Same harness as M5/M7 — needs Postgres
// (DATABASE_URL) + FsBlobStore temp dir; skips when no DATABASE_URL is configured.
const DB_URL = process.env.DATABASE_URL;
const MIGRATIONS = fileURLToPath(new URL("../../db/drizzle", import.meta.url));

const enc = new TextEncoder();
const README_MD = "# Hello\n\nThis is a paragraph about **chats** in scholia.\n";

describe.skipIf(!DB_URL)("M8: Private Chats + reviewer agents", () => {
  let sql: ReturnType<typeof postgres>;
  let app: ReturnType<typeof createApp>;
  let blobDir: string;

  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1 });
    const db = drizzle(sql, { schema });
    await migrateWithLock(sql, db, MIGRATIONS);
    blobDir = await mkdtemp(join(tmpdir(), "scholia-blobs-m8-"));
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

  const json = (
    path: string,
    method: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json", ...(headers ?? {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  // Create a single-Markdown-Page Site, returning its slug + owner token.
  async function makeSite(): Promise<{ slug: string; token: string }> {
    const bytes = enc.encode(README_MD);
    const hash = hashBytes(bytes);
    const diff = await json("/blobs/diff", "POST", { hashes: [hash] });
    const { missing } = (await diff.json()) as { missing: string[] };
    for (const h of missing) {
      await app.request(`/blobs/${h}`, { method: "PUT", body: bytes.buffer as ArrayBuffer });
    }
    const res = await json("/sites", "POST", {
      contentSource: { kind: "local" },
      files: [{ path: "README.md", kind: "markdown", contentHash: hash }],
    });
    const body = (await res.json()) as { slug: string; token: string };
    return { slug: body.slug, token: body.token };
  }

  async function mintViewer(slug: string): Promise<string> {
    const res = await json(`/sites/${slug}/viewers`, "POST");
    expect(res.status).toBe(201);
    return ((await res.json()) as { viewerId: string }).viewerId;
  }

  async function mintAgentToken(slug: string, viewerId: string): Promise<string> {
    const res = await json(`/sites/${slug}/viewers/${viewerId}/agent-token`, "POST");
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string; agentUrl: string };
    expect(body.agentUrl).toContain(`/s/${slug}?token=${body.token}`);
    return body.token;
  }

  // Create a private Chat as the human owner viewer. Returns the DTO.
  async function makeChat(slug: string, viewerId: string, displayName = "Jane"): Promise<any> {
    const res = await json(`/sites/${slug}/conversations`, "POST", {
      pagePath: "README.md",
      anchor: { textQuote: { exact: "chats" } },
      body: "Is this the right term for my private notes?",
      viewerId,
      displayName,
      visibility: "private",
    });
    expect(res.status).toBe(201);
    return res.json();
  }

  test("mint Viewer-scoped agent token; 404 for unknown viewer/site", async () => {
    const { slug } = await makeSite();
    const viewerId = await mintViewer(slug);

    const ok = await json(`/sites/${slug}/viewers/${viewerId}/agent-token`, "POST");
    expect(ok.status).toBe(201);
    const body = (await ok.json()) as { token: string; agentUrl: string };
    expect(typeof body.token).toBe("string");
    expect(body.agentUrl).toBe(`http://viewer.test/s/${slug}?token=${body.token}`);

    // Re-minting rotates (revokes the prior token): the old token no longer works.
    const old = body.token;
    const rotated = await mintAgentToken(slug, viewerId);
    expect(rotated).not.toBe(old);

    // Unknown viewer / site → 404.
    expect(
      (await json(`/sites/${slug}/viewers/00000000-0000-0000-0000-000000000000/agent-token`, "POST"))
        .status,
    ).toBe(404);
    expect((await json(`/sites/nope/viewers/${viewerId}/agent-token`, "POST")).status).toBe(404);
  });

  test("private Chat is invisible publicly, visible only to its owning viewer", async () => {
    const { slug, token: ownerToken } = await makeSite();
    const jane = await mintViewer(slug);
    const bob = await mintViewer(slug);
    const chat = await makeChat(slug, jane);
    expect(chat.visibility).toBe("private");
    expect(chat.comments).toHaveLength(1);

    // Not in the public Threads listing.
    const publicList = (await (
      await app.request(`/sites/${slug}/conversations?path=README.md`)
    ).json()) as any[];
    expect(publicList.find((c) => c.id === chat.id)).toBeUndefined();

    // Not in the site-wide public comment feed (M7).
    const feed = (await (await app.request(`/sites/${slug}/comments`)).json()) as {
      comments: any[];
    };
    expect(feed.comments.find((c) => c.conversationId === chat.id)).toBeUndefined();

    // Visible in the owning viewer's /chats.
    const janeChats = (await (
      await app.request(`/sites/${slug}/chats?viewerId=${jane}`)
    ).json()) as any[];
    expect(janeChats.map((c) => c.id)).toContain(chat.id);

    // Another viewer sees nothing.
    const bobChats = (await (
      await app.request(`/sites/${slug}/chats?viewerId=${bob}`)
    ).json()) as any[];
    expect(bobChats.find((c) => c.id === chat.id)).toBeUndefined();

    // No identity → 401.
    expect((await app.request(`/sites/${slug}/chats`)).status).toBe(401);

    // Owner token → 403 (owners do not have Chats).
    const ownerChats = await app.request(`/sites/${slug}/chats`, { headers: bearer(ownerToken) });
    expect(ownerChats.status).toBe(403);
  });

  test("Viewer's agent lists + replies in the Chat; owner token is refused", async () => {
    const { slug, token: ownerToken } = await makeSite();
    const jane = await mintViewer(slug);
    const chat = await makeChat(slug, jane);
    const agentToken = await mintAgentToken(slug, jane);

    // The agent lists the Chat via its token.
    const agentChats = (await (
      await app.request(`/sites/${slug}/chats`, { headers: bearer(agentToken) })
    ).json()) as any[];
    expect(agentChats.map((c) => c.id)).toContain(chat.id);

    // The agent replies — attributed as a viewer-tier agent.
    const reply = await json(
      `/sites/${slug}/conversations/${chat.id}/comments`,
      "POST",
      { body: "Yes, 'chats' matches the CONTEXT term." },
      bearer(agentToken),
    );
    expect(reply.status).toBe(201);
    const replyDto = (await reply.json()) as any;
    expect(replyDto.author.kind).toBe("agent");
    expect(replyDto.author.tier).toBe("viewer");
    expect(replyDto.author.name).toBe("Jane's agent");

    // Owner token cannot read the Chat (via re-fetch) nor write to it.
    const ownerReply = await json(
      `/sites/${slug}/conversations/${chat.id}/comments`,
      "POST",
      { body: "owner poking in", label: "owner-bot" },
      bearer(ownerToken),
    );
    expect(ownerReply.status).toBe(403);

    // A different viewer's human path is refused too.
    const bob = await mintViewer(slug);
    const bobReply = await json(`/sites/${slug}/conversations/${chat.id}/comments`, "POST", {
      body: "sneaking in",
      viewerId: bob,
      displayName: "Bob",
    });
    expect(bobReply.status).toBe(403);
  });

  test("Viewer's agent may create a public Thread (viewer tier)", async () => {
    const { slug } = await makeSite();
    const jane = await mintViewer(slug);
    const agentToken = await mintAgentToken(slug, jane);

    const res = await json(
      `/sites/${slug}/conversations`,
      "POST",
      { pagePath: "README.md", anchor: { textQuote: { exact: "paragraph" } }, body: "public note" },
      bearer(agentToken),
    );
    expect(res.status).toBe(201);
    const conv = (await res.json()) as any;
    expect(conv.visibility).toBe("public");
    expect(conv.comments[0].author.kind).toBe("agent");
    expect(conv.comments[0].author.tier).toBe("viewer");
  });

  test("owner token cannot create a private Chat", async () => {
    const { slug, token: ownerToken } = await makeSite();
    const res = await json(
      `/sites/${slug}/conversations`,
      "POST",
      { pagePath: null, anchor: null, body: "no chats for owners", visibility: "private" },
      bearer(ownerToken),
    );
    expect(res.status).toBe(403);
  });

  test("Promotion hides non-selected messages and flips the Chat to a public Thread", async () => {
    const { slug } = await makeSite();
    const jane = await mintViewer(slug);
    const chat = await makeChat(slug, jane);
    const firstCommentId = chat.comments[0].id as string;
    const agentToken = await mintAgentToken(slug, jane);

    // Agent reply we will NOT keep on promotion.
    const reply = await json(
      `/sites/${slug}/conversations/${chat.id}/comments`,
      "POST",
      { body: "internal agent scratch note" },
      bearer(agentToken),
    );
    const replyId = ((await reply.json()) as any).id as string;

    // Promote: keep only the first (human) comment, add a summary.
    const promoted = await json(`/sites/${slug}/conversations/${chat.id}/promote`, "POST", {
      commentIds: [firstCommentId],
      summary: "Summary: confirmed 'chats' is the right term.",
      viewerId: jane,
    });
    expect(promoted.status).toBe(200);
    const dto = (await promoted.json()) as any;
    expect(dto.visibility).toBe("public");

    const bodies = dto.comments.map((c: any) => c.body);
    expect(bodies).toContain(chat.comments[0].body);
    expect(bodies).toContain("Summary: confirmed 'chats' is the right term.");
    // The non-selected agent reply is hidden (absent, not tombstoned).
    expect(dto.comments.find((c: any) => c.id === replyId)).toBeUndefined();

    // Now visible publicly as a Thread.
    const publicList = (await (
      await app.request(`/sites/${slug}/conversations?path=README.md`)
    ).json()) as any[];
    const found = publicList.find((c) => c.id === chat.id);
    expect(found).toBeDefined();
    expect(found.comments.find((c: any) => c.id === replyId)).toBeUndefined();

    // No longer a Chat for the owning viewer.
    const janeChats = (await (
      await app.request(`/sites/${slug}/chats?viewerId=${jane}`)
    ).json()) as any[];
    expect(janeChats.find((c) => c.id === chat.id)).toBeUndefined();

    // Promoting a public Thread is rejected.
    const again = await json(`/sites/${slug}/conversations/${chat.id}/promote`, "POST", {
      commentIds: [firstCommentId],
      viewerId: jane,
    });
    expect(again.status).toBe(400);
  });

  test("only the owning viewer may promote", async () => {
    const { slug, token: ownerToken } = await makeSite();
    const jane = await mintViewer(slug);
    const bob = await mintViewer(slug);
    const chat = await makeChat(slug, jane);
    const firstCommentId = chat.comments[0].id as string;

    // Another viewer cannot promote.
    const bobPromote = await json(`/sites/${slug}/conversations/${chat.id}/promote`, "POST", {
      commentIds: [firstCommentId],
      viewerId: bob,
    });
    expect(bobPromote.status).toBe(403);

    // Owner token cannot promote a Chat.
    const ownerPromote = await json(
      `/sites/${slug}/conversations/${chat.id}/promote`,
      "POST",
      { commentIds: [firstCommentId] },
      bearer(ownerToken),
    );
    expect(ownerPromote.status).toBe(403);
  });

  test("public Thread flow still works (M5 regression)", async () => {
    const { slug } = await makeSite();
    const jane = await mintViewer(slug);

    const created = await json(`/sites/${slug}/conversations`, "POST", {
      pagePath: "README.md",
      anchor: { textQuote: { exact: "chats" } },
      body: "public feedback",
      viewerId: jane,
      displayName: "Jane",
    });
    expect(created.status).toBe(201);
    const conv = (await created.json()) as any;
    expect(conv.visibility).toBe("public");

    // In the public listing, absent from /chats.
    const publicList = (await (
      await app.request(`/sites/${slug}/conversations?path=README.md`)
    ).json()) as any[];
    expect(publicList.map((c) => c.id)).toContain(conv.id);

    const janeChats = (await (
      await app.request(`/sites/${slug}/chats?viewerId=${jane}`)
    ).json()) as any[];
    expect(janeChats.find((c) => c.id === conv.id)).toBeUndefined();
  });
});

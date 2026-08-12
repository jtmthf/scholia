import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { schema } from "@scholia/db";
import { FsBlobStore, hashBytes } from "@scholia/core";
import { createApp } from "../src/app.js";

// Integration test for M5: anchoring + public comment Threads. Mirrors the M3
// sites.test.ts harness — needs a Postgres (DATABASE_URL); FsBlobStore in a temp
// dir so MinIO isn't required. Provided by the root globalSetup.
const DB_URL = process.env.DATABASE_URL!;

const enc = new TextEncoder();
const README_MD = "# Hello\n\nThis is a paragraph about **anchoring** in scholia.\n";

describe("M5: Anchoring + public Threads", () => {
  let sql: ReturnType<typeof postgres>;
  let app: ReturnType<typeof createApp>;
  let blobDir: string;

  beforeAll(async () => {
    sql = postgres(DB_URL, { max: 1 });
    const db = drizzle(sql, { schema });
    blobDir = await mkdtemp(join(tmpdir(), "scholia-blobs-m5-"));
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

  // Create a single-Markdown-Page Site via the blob negotiation + manifest flow,
  // returning its slug.
  async function makeSite(): Promise<string> {
    const bytes = enc.encode(README_MD);
    const hash = hashBytes(bytes);
    const diff = await app.request("/blobs/diff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hashes: [hash] }),
    });
    const { missing } = (await diff.json()) as { missing: string[] };
    for (const h of missing) {
      await app.request(`/blobs/${h}`, { method: "PUT", body: bytes.buffer });
    }
    const res = await app.request("/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contentSource: { kind: "local" },
        files: [{ path: "README.md", kind: "markdown", contentHash: hash }],
      }),
    });
    const { slug } = (await res.json()) as { slug: string };
    return slug;
  }

  const json = (path: string, method: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  async function mintViewer(slug: string): Promise<string> {
    const res = await json(`/sites/${slug}/viewers`, "POST");
    expect(res.status).toBe(201);
    return ((await res.json()) as { viewerId: string }).viewerId;
  }

  test("mint viewer + create anchored Thread + list", async () => {
    const slug = await makeSite();
    const viewerId = await mintViewer(slug);

    const created = await json(`/sites/${slug}/conversations`, "POST", {
      pagePath: "README.md",
      anchor: {
        textQuote: { exact: "anchoring", prefix: "about ", suffix: " in scholia" },
        smIds: [1],
      },
      body: "Is this the right term?",
      viewerId,
      displayName: "Jane",
    });
    expect(created.status).toBe(201);
    const conv = await created.json();
    expect(conv.pagePath).toBe("README.md");
    expect(conv.anchor.textQuote.exact).toBe("anchoring");
    // mapSmIdsToSourceRange wired end-to-end: smIds[1] resolves to a source span.
    expect(conv.anchor.sourceRange).toBeDefined();
    expect(conv.resolved).toBe(false);
    expect(conv.comments).toHaveLength(1);
    expect(conv.comments[0].author.name).toBe("Jane");
    expect(conv.comments[0].author.kind).toBe("human");
    expect(conv.comments[0].mine).toBe(true);

    // List it back for the page (with viewerId → mine flags).
    const listed = await (
      await app.request(`/sites/${slug}/conversations?path=README.md&viewerId=${viewerId}`)
    ).json();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(conv.id);
  });

  test("reply, react (toggle + palette), resolve/reopen", async () => {
    const slug = await makeSite();
    const viewerId = await mintViewer(slug);
    const conv = await (
      await json(`/sites/${slug}/conversations`, "POST", {
        pagePath: "README.md",
        anchor: { textQuote: { exact: "paragraph" }, smIds: [1] },
        body: "first",
        viewerId,
        displayName: "Jane",
      })
    ).json();
    const commentId = conv.comments[0].id;

    // Reply.
    const reply = await json(`/sites/${slug}/conversations/${conv.id}/comments`, "POST", {
      body: "second",
      viewerId,
      displayName: "Jane",
    });
    expect(reply.status).toBe(201);

    // React with a palette emoji.
    const react = await json(`/sites/${slug}/comments/${commentId}/reactions`, "POST", {
      emoji: "👍",
      viewerId,
      displayName: "Jane",
    });
    expect(react.status).toBe(200);
    let groups = (await react.json()) as any[];
    expect(groups.find((g) => g.emoji === "👍")?.count).toBe(1);
    expect(groups.find((g) => g.emoji === "👍")?.mine).toBe(true);
    expect(groups.find((g) => g.emoji === "👍")?.authors).toEqual(["Jane"]);

    // Toggle it off.
    groups = (await (
      await json(`/sites/${slug}/comments/${commentId}/reactions`, "POST", {
        emoji: "👍",
        viewerId,
        displayName: "Jane",
      })
    ).json()) as any[];
    expect(groups.find((g) => g.emoji === "👍")).toBeUndefined();

    // Non-palette emoji is rejected.
    const bad = await json(`/sites/${slug}/comments/${commentId}/reactions`, "POST", {
      emoji: "🚀",
      viewerId,
      displayName: "Jane",
    });
    expect(bad.status).toBe(400);

    // Resolve, then reopen (anyone may).
    const resolved = await (
      await json(`/sites/${slug}/conversations/${conv.id}/resolve`, "POST", {
        viewerId,
        displayName: "Jane",
      })
    ).json();
    expect(resolved.resolved).toBe(true);
    expect(resolved.resolvedBy).toBe("Jane");

    const reopened = await (
      await json(`/sites/${slug}/conversations/${conv.id}/resolve`, "DELETE", {
        viewerId,
        displayName: "Jane",
      })
    ).json();
    expect(reopened.resolved).toBe(false);
  });

  test("edit/delete own comment; another viewer is forbidden", async () => {
    const slug = await makeSite();
    const jane = await mintViewer(slug);
    const bob = await mintViewer(slug);
    const conv = await (
      await json(`/sites/${slug}/conversations`, "POST", {
        pagePath: "README.md",
        anchor: { textQuote: { exact: "scholia" }, smIds: [1] },
        body: "original",
        viewerId: jane,
        displayName: "Jane",
      })
    ).json();
    const commentId = conv.comments[0].id;

    // Bob cannot edit Jane's comment.
    const bobEdit = await json(`/sites/${slug}/comments/${commentId}`, "PATCH", {
      body: "hacked",
      viewerId: bob,
    });
    expect(bobEdit.status).toBe(403);

    // Jane can edit her own → editedAt set.
    const janeEdit = await json(`/sites/${slug}/comments/${commentId}`, "PATCH", {
      body: "edited",
      viewerId: jane,
    });
    expect(janeEdit.status).toBe(200);
    const edited = await janeEdit.json();
    expect(edited.body).toBe("edited");
    expect(edited.editedAt).not.toBeNull();

    // Bob cannot delete Jane's comment.
    const bobDel = await json(`/sites/${slug}/comments/${commentId}`, "DELETE", { viewerId: bob });
    expect(bobDel.status).toBe(403);

    // Jane deletes her own → tombstone (deleted, empty body).
    const janeDel = await json(`/sites/${slug}/comments/${commentId}`, "DELETE", {
      viewerId: jane,
    });
    expect(janeDel.status).toBe(204);

    const listed = (await (
      await app.request(`/sites/${slug}/conversations?path=README.md&viewerId=${jane}`)
    ).json()) as any[];
    expect(listed[0].comments[0].deleted).toBe(true);
    expect(listed[0].comments[0].body).toBe("");
  });

  test("page-level Thread (no anchor)", async () => {
    const slug = await makeSite();
    const viewerId = await mintViewer(slug);
    const created = await json(`/sites/${slug}/conversations`, "POST", {
      pagePath: null,
      anchor: null,
      body: "general feedback",
      viewerId,
      displayName: "Jane",
    });
    expect(created.status).toBe(201);
    const conv = await created.json();
    expect(conv.pagePath).toBeNull();
    expect(conv.anchor).toBeNull();

    // Page-level list (no path param).
    const listed = (await (
      await app.request(`/sites/${slug}/conversations?viewerId=${viewerId}`)
    ).json()) as any[];
    expect(listed).toHaveLength(1);
    expect(listed[0].anchor).toBeNull();
  });

  test("validation + not-found", async () => {
    const slug = await makeSite();
    const viewerId = await mintViewer(slug);

    // Empty body rejected.
    const empty = await json(`/sites/${slug}/conversations`, "POST", {
      pagePath: "README.md",
      anchor: null,
      body: "   ",
      viewerId,
      displayName: "Jane",
    });
    expect(empty.status).toBe(400);

    // Unknown slug / conversation / comment.
    expect((await json(`/sites/nope/viewers`, "POST")).status).toBe(404);
    expect(
      (
        await json(
          `/sites/${slug}/conversations/00000000-0000-0000-0000-000000000000/comments`,
          "POST",
          {
            body: "x",
            viewerId,
            displayName: "Jane",
          },
        )
      ).status,
    ).toBe(404);
  });
});

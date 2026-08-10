import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { schema, type Db } from "@scholia/db";
import { hashBytes, type MirrorContext, type MirrorEvent, type Anchor } from "@scholia/core";
import { FakeGitHubApi } from "@scholia/github";
import { createApp } from "../src/app.js";
import { GitHubMirrorProvider } from "../src/mirror/github-provider.js";

// Integration test for the GitHub outbound mirror dispatch (Sub-Task 6, R3/R5).
// Verifies: in-diff → review comment, out-of-diff → issue comment, resolve →
// GraphQL, promotion → N comments, dedup → no-op, comment_mirrors rows synced.
// Needs Postgres (DATABASE_URL); provided by the root globalSetup.
const DB_URL = process.env.DATABASE_URL!;

const enc = new TextEncoder();

// A 5-line markdown file for line-mapping:
// Line 1: # Title
// Line 2: (blank)
// Line 3: Some **bold** text.
// Line 4: (blank)
// Line 5: A second paragraph.
const PAGE_MD = "# Title\n\nSome **bold** text.\n\nA second paragraph.\n";
const PAGE_HASH = hashBytes(enc.encode(PAGE_MD));
const HEAD_SHA = "dispatch-head-1";
const REPO = "octocat/dispatch-test";

describe("M10: GitHub outbound dispatch", () => {
  let sql: ReturnType<typeof postgres>;
  let db: Db;
  let blobDir: string;
  let fakeApi: FakeGitHubApi;
  let provider: GitHubMirrorProvider;
  let ctx: MirrorContext;
  let siteSlug: string;
  let siteId: string;
  let versionId: string;

  beforeAll(async () => {
    sql = postgres(DB_URL, { max: 1 });
    db = drizzle(sql, { schema });
    blobDir = await mkdtemp(join(tmpdir(), "scholia-blobs-dispatch-"));

    // Seed the fake GitHub API with a PR.
    fakeApi = new FakeGitHubApi();
    fakeApi.seedPr({ owner: "octocat", name: "dispatch-test" }, 7, {
      headSha: HEAD_SHA,
      branch: "feature",
      title: "Test PR",
      files: [
        { filename: "page.md", status: "added", sha: "blob-1", content: enc.encode(PAGE_MD) },
      ],
    });
    // Line 3 and 5 are in the diff (added lines); line 1 is context.
    fakeApi.setDiffLines({ owner: "octocat", name: "dispatch-test" }, "page.md", new Set([3, 5]));

    // Store the source blob so the context can retrieve it.
    const { FsBlobStore } = await import("@scholia/core");
    const store = new FsBlobStore(blobDir);
    if (!(await store.has(PAGE_HASH))) await store.put(enc.encode(PAGE_MD));

    provider = new GitHubMirrorProvider({
      api: fakeApi,
      db,
      config: {
        appId: "1",
        appSlug: "scholia",
        privateKeyPem: "fake",
        webhookSecret: "fake",
        apiBase: "https://api.github.com",
        reconcileIntervalMs: 60_000,
      },
    });

    // A mock context that resolves our test page without needing a real manifest.
    ctx = {
      async getManifestEntry(_vId, pagePath) {
        if (pagePath !== "page.md") return null;
        return {
          path: "page.md",
          kind: "markdown" as const,
          contentHash: PAGE_HASH,
          renderedHash: null,
          sourceMapHash: null,
        };
      },
      async getSource(contentHash) {
        if (contentHash === PAGE_HASH) return enc.encode(PAGE_MD);
        return null;
      },
    };

    // Create a real PR-backed Site so we have a siteId + versionId for the events.
    const { upsertGitHubInstallation } = await import("@scholia/db");
    await upsertGitHubInstallation(db, {
      installationId: 77,
      account: "octocat",
      repos: [REPO],
    });

    const app = createApp({
      db,
      store,
      publicUrl: "http://content.test",
      viewerUrl: "http://viewer.test",
      mirror: [provider],
    });

    const res = await app.request("/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentSource: { kind: "pr", repo: REPO, prNumber: 7 } }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    siteSlug = body.slug;

    // Fetch the siteId + versionId from the DB.
    const { getSiteBySlug, getLatestVersionId } = await import("@scholia/db");
    const site = await getSiteBySlug(db, siteSlug);
    expect(site).toBeTruthy();
    siteId = site!.id;
    const latest = await getLatestVersionId(db, siteId);
    expect(latest).toBeTruthy();
    versionId = latest!.id;
  });

  afterAll(async () => {
    await sql?.end();
    if (blobDir) await rm(blobDir, { recursive: true, force: true });
  });

  // Create a real Conversation + first Comment in the DB so the comment_mirrors
  // FK is satisfied. Returns the ids to use in a dispatch event.
  async function createThread(opts: {
    body?: string;
    anchor?: Anchor | null;
  }): Promise<{ conversationId: string; commentId: string }> {
    const { createConversation } = await import("@scholia/db");
    const result = await createConversation(db, {
      siteId,
      createdVersionId: versionId,
      pagePath: "page.md",
      visibility: "public",
      anchor: opts.anchor ?? null,
      firstComment: {
        versionId,
        body: opts.body ?? "Test comment",
        author: { name: "Jane", kind: "human", tier: "viewer", source: "native" },
        authorViewerId: null,
      },
    });
    return { conversationId: result.conversationId, commentId: result.firstCommentId };
  }

  function mkCommentEvent(
    ids: { commentId: string; conversationId: string },
    over: { anchor?: Anchor | null; body?: string; author?: any },
  ): Extract<MirrorEvent, { type: "comment_created" }> {
    return {
      type: "comment_created",
      siteId,
      mirrorBinding: { provider: "github", repo: REPO, prNumber: 7 },
      conversationId: ids.conversationId,
      pagePath: "page.md",
      createdVersionId: versionId,
      commentId: ids.commentId,
      author: over.author ?? {
        name: "Jane",
        kind: "human" as const,
        tier: "viewer" as const,
        source: "native" as const,
      },
      body: over.body ?? "Nice work.",
      anchor: over.anchor ?? null,
      origin: "scholia",
    };
  }

  // Shared IDs so the dedup + resolve tests can reference the in-diff comment.
  // Populated by the first test (must run before dedup/resolve).
  let inDiffIds: { conversationId: string; commentId: string };

  test("in-diff comment → createPrReviewComment with bot body", async () => {
    // Source range covering "Some **bold** text." on line 3 (in-diff).
    // Line 3 starts at offset 9 (after "# Title\n\n").
    inDiffIds = await createThread({
      anchor: { textQuote: { exact: "Some **bold** text." }, sourceRange: { start: 9, end: 28 } },
      body: "This bold text is great.",
    });
    const event = mkCommentEvent(inDiffIds, {
      anchor: { textQuote: { exact: "Some **bold** text." }, sourceRange: { start: 9, end: 28 } },
      body: "This bold text is great.",
    });
    await provider.dispatch([event], ctx);

    expect(fakeApi.createdReviewComments).toHaveLength(1);
    const rec = fakeApi.createdReviewComments[0]!;
    expect(rec.input.path).toBe("page.md");
    expect(rec.input.line).toBe(3);
    expect(rec.input.side).toBe("RIGHT");
    expect(rec.input.body).toContain("**Jane** (via Scholia)");
    expect(rec.input.body).toContain("This bold text is great.");
    expect(rec.input.commitId).toBe(HEAD_SHA);

    // comment_mirrors row is synced.
    const { getMirrorRow } = await import("@scholia/db");
    const row = await getMirrorRow(db, inDiffIds.commentId, "github");
    expect(row?.status).toBe("synced");
    expect(row?.externalId).toBe(String(rec.created.id));
  });

  test("out-of-diff comment → createIssueComment with quoted text", async () => {
    // Line 1 ("# Title") is NOT in the diff set.
    const ids = await createThread({
      anchor: { sourceRange: { start: 0, end: 7 }, textQuote: { exact: "# Title" } },
      body: "The title should be different.",
    });
    const event = mkCommentEvent(ids, {
      anchor: { sourceRange: { start: 0, end: 7 }, textQuote: { exact: "# Title" } },
      body: "The title should be different.",
    });
    await provider.dispatch([event], ctx);

    // Should have created an issue comment (fallback), not a review comment.
    const issueRecs = fakeApi.createdIssueComments.filter(
      (r) => r.pr === 7 && r.body.includes("The title should be different."),
    );
    expect(issueRecs).toHaveLength(1);
    expect(issueRecs[0]!.body).toContain("**Jane** (via Scholia)");
    expect(issueRecs[0]!.body).toContain("> # Title");

    const { getMirrorRow } = await import("@scholia/db");
    const row = await getMirrorRow(db, ids.commentId, "github");
    expect(row?.status).toBe("synced");
  });

  test("page-level comment (no anchor) → createIssueComment", async () => {
    const ids = await createThread({ body: "Overall this looks good." });
    const event = mkCommentEvent(ids, {
      anchor: null,
      body: "Overall this looks good.",
    });
    await provider.dispatch([event], ctx);

    const issueRecs = fakeApi.createdIssueComments.filter(
      (r) => r.pr === 7 && r.body.includes("Overall this looks good."),
    );
    expect(issueRecs).toHaveLength(1);
    expect(issueRecs[0]!.body).not.toContain(">");

    const { getMirrorRow } = await import("@scholia/db");
    const row = await getMirrorRow(db, ids.commentId, "github");
    expect(row?.status).toBe("synced");
  });

  test("re-dispatch of a synced row → no-op (dedup)", async () => {
    const before = fakeApi.createdReviewComments.length;
    const beforeIssue = fakeApi.createdIssueComments.length;

    // Re-dispatch the in-diff comment (already synced).
    const event = mkCommentEvent(inDiffIds, {
      anchor: { textQuote: { exact: "Some **bold** text." }, sourceRange: { start: 9, end: 28 } },
      body: "This bold text is great.",
    });
    await provider.dispatch([event], ctx);

    expect(fakeApi.createdReviewComments).toHaveLength(before);
    expect(fakeApi.createdIssueComments).toHaveLength(beforeIssue);
  });

  test("resolve event → resolveReviewThread called", async () => {
    // The in-diff comment created a review thread. Dispatch resolve for its conversation.
    const event: Extract<MirrorEvent, { type: "resolve" }> = {
      type: "resolve",
      siteId,
      mirrorBinding: { provider: "github", repo: REPO, prNumber: 7 },
      conversationId: inDiffIds.conversationId,
      pagePath: "page.md",
      createdVersionId: versionId,
      resolved: true,
      resolvedBy: "Jane",
    };
    await provider.dispatch([event], ctx);

    // Find a resolve call in the fake API's recorded calls.
    const resolveCall = fakeApi.resolveCalls.find((c) => c.resolve === true);
    expect(resolveCall).toBeTruthy();
  });

  test("promotion event → each comment pushed as a separate review/issue comment", async () => {
    const beforeReviews = fakeApi.createdReviewComments.length;
    const beforeIssue = fakeApi.createdIssueComments.length;

    // Create two real comments in the DB so comment_mirrors FKs are satisfied.
    // They live in separate conversations (the promotion event uses a single
    // conversationId but the dispatch maps each comment independently).
    const promoThread1 = await createThread({
      anchor: { textQuote: { exact: "Some **bold** text." }, sourceRange: { start: 9, end: 28 } },
      body: "First promoted comment.",
    });
    const promoThread2 = await createThread({
      body: "Second promoted comment.",
    });

    const event: Extract<MirrorEvent, { type: "promotion" }> = {
      type: "promotion",
      siteId,
      mirrorBinding: { provider: "github", repo: REPO, prNumber: 7 },
      conversationId: promoThread1.conversationId,
      pagePath: "page.md",
      createdVersionId: versionId,
      comments: [
        {
          commentId: promoThread1.commentId,
          author: { name: "Jane", kind: "human", tier: "viewer", source: "native" },
          body: "First promoted comment.",
          anchor: {
            textQuote: { exact: "Some **bold** text." },
            sourceRange: { start: 9, end: 28 },
          },
        },
        {
          commentId: promoThread2.commentId,
          author: { name: "Jane", kind: "human", tier: "viewer", source: "native" },
          body: "Second promoted comment.",
          anchor: null,
        },
      ],
    };
    await provider.dispatch([event], ctx);

    // First comment (in-diff) → review comment; second (no anchor) → issue comment.
    expect(fakeApi.createdReviewComments).toHaveLength(beforeReviews + 1);
    expect(fakeApi.createdIssueComments).toHaveLength(beforeIssue + 1);

    const reviewRec = fakeApi.createdReviewComments[beforeReviews]!;
    expect(reviewRec.input.body).toContain("First promoted comment.");

    const issueRec = fakeApi.createdIssueComments[beforeIssue]!;
    expect(issueRec.body).toContain("Second promoted comment.");

    // Both have comment_mirrors rows.
    const { getMirrorRow } = await import("@scholia/db");
    expect((await getMirrorRow(db, promoThread1.commentId, "github"))?.status).toBe("synced");
    expect((await getMirrorRow(db, promoThread2.commentId, "github"))?.status).toBe("synced");
  });
});

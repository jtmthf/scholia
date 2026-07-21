import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { schema, type Db, upsertGitHubInstallation, getMirrorRow } from "@collab/db";
import { hashBytes, FsBlobStore } from "@collab/core";
import { FakeGitHubApi } from "@collab/github";
import { createApp } from "../src/app.js";
import { GitHubMirrorProvider } from "../src/mirror/github-provider.js";
import { importInbound } from "../src/mirror/importer.js";
import { reconcileOneSite } from "../src/mirror/reconcile.js";
import { migrateWithLock } from "./helpers/migrate.js";

// Integration test for M10 inbound: webhook signature verification, inbound
// import (Thread creation, dedup, tombstone, detach), and the reconciliation
// poller. Needs Postgres (DATABASE_URL); skips when unset.
const DB_URL = process.env.DATABASE_URL;
const MIGRATIONS = fileURLToPath(new URL("../../db/drizzle", import.meta.url));
const WEBHOOK_SECRET = "test-webhook-secret";

const enc = new TextEncoder();
const PAGE_MD = "# Hello PR\n\nSome **bold** text.\n\nA second paragraph.\n";
const HEAD_SHA = "inbound-head-sha";
const REPO = "octocat/inbound-test";

// Unique external IDs per test run so DB residue from a previous run doesn't
// trigger dedup (the shared DB persists between vitest invocations).
const ID_BASE = Date.now();
const id = (n: number) => ID_BASE + n;

function sign(body: string, secret: string = WEBHOOK_SECRET): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

// Build a `pull_request_review_comment` webhook payload.
function reviewCommentPayload(
  commentId: number,
  body: string,
  path: string,
  line: number,
  login = "octocat",
): string {
  return JSON.stringify({
    action: "created",
    comment: {
      id: commentId,
      html_url: `https://github.com/${REPO}/pull/1#discussion_r${commentId}`,
      path,
      line,
      side: "RIGHT",
      commit_id: HEAD_SHA,
      user: { login, avatar_url: null },
      body,
    },
    pull_request: { number: 1 },
    repository: { full_name: REPO },
  });
}

// Build an `issue_comment` webhook payload.
function issueCommentPayload(
  commentId: number,
  body: string,
  login = "octocat",
): string {
  return JSON.stringify({
    action: "created",
    comment: {
      id: commentId,
      html_url: `https://github.com/${REPO}/issues/1#issuecomment-${commentId}`,
      user: { login, avatar_url: null },
      body,
    },
    issue: { number: 1, pull_request: {} },
    repository: { full_name: REPO },
  });
}

// Build a `pull_request_review_thread` webhook payload.
function threadResolvedPayload(
  action: "resolved" | "unresolved",
  rootCommentId: number,
  resolverLogin = "reviewer1",
): string {
  return JSON.stringify({
    action,
    thread: { comments: [{ id: rootCommentId }] },
    pull_request: { number: 1 },
    repository: { full_name: REPO },
    sender: { login: resolverLogin },
  });
}

// Build a `pull_request_review_comment` deleted payload.
function deletedPayload(commentId: number): string {
  return JSON.stringify({
    action: "deleted",
    comment: {
      id: commentId,
      html_url: `https://github.com/${REPO}/pull/1#discussion_r${commentId}`,
      path: "README.md",
      line: 1,
      side: "RIGHT",
      commit_id: HEAD_SHA,
      user: { login: "octocat", avatar_url: null },
      body: "deleted comment",
    },
    pull_request: { number: 1 },
    repository: { full_name: REPO },
  });
}

describe.skipIf(!DB_URL)("M10: Inbound webhooks + reconciliation", () => {
  let sql: ReturnType<typeof postgres>;
  let db: Db;
  let app: ReturnType<typeof createApp>;
  let blobDir: string;
  let fakeApi: FakeGitHubApi;
  let siteSlug: string;
  let ownerToken: string;

  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1 });
    db = drizzle(sql, { schema }) as unknown as Db;
    await migrateWithLock(sql, db as unknown as ReturnType<typeof drizzle>, MIGRATIONS);
    blobDir = await mkdtemp(join(tmpdir(), "collab-blobs-inbound-"));

    // Seed the fake GitHub API.
    fakeApi = new FakeGitHubApi();
    fakeApi.seedPr(
      { owner: "octocat", name: "inbound-test" },
      1,
      {
        headSha: HEAD_SHA,
        branch: "feature",
        title: "Test PR",
        files: [
          { filename: "README.md", status: "added", sha: "blob-1", content: enc.encode(PAGE_MD) },
        ],
      },
    );
    fakeApi.setDiffLines({ owner: "octocat", name: "inbound-test" }, "README.md", new Set([1, 3, 5]));

    await upsertGitHubInstallation(db, {
      installationId: 88,
      account: "octocat",
      repos: [REPO],
    });

    const provider = new GitHubMirrorProvider({
      api: fakeApi,
      db,
      config: {
        appId: "1",
        appSlug: "collab",
        privateKeyPem: "fake",
        webhookSecret: WEBHOOK_SECRET,
        apiBase: "https://api.github.com",
        reconcileIntervalMs: 60_000,
      },
    });

    const store = new FsBlobStore(blobDir);
    app = createApp({
      db,
      store,
      publicUrl: "http://content.test",
      viewerUrl: "http://viewer.test",
      mirror: [provider],
      github: {
        appId: "1",
        appSlug: "collab",
        privateKeyPem: "fake",
        webhookSecret: WEBHOOK_SECRET,
        apiBase: "https://api.github.com",
        reconcileIntervalMs: 60_000,
      },
    });

    // Create a PR-backed Site to receive comments.
    const res = await app.request("/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentSource: { kind: "pr", repo: REPO, prNumber: 1 } }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    siteSlug = body.slug;
    ownerToken = body.token;
  });

  afterAll(async () => {
    await sql?.end();
    if (blobDir) await rm(blobDir, { recursive: true, force: true });
  });

  test("signed review_comment webhook → creates a public Thread + synced mirror row", async () => {
    const payload = reviewCommentPayload(id(1), "Looks risky here.", "README.md", 3);
    const res = await app.request("/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "pull_request_review_comment",
        "x-hub-signature-256": sign(payload),
      },
      body: payload,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.accepted).toBe(1);

    // Verify a Thread was created with a github-sourced comment.
    const commentsRes = await app.request(`/sites/${siteSlug}/comments`);
    expect(commentsRes.status).toBe(200);
    const commentsBody = (await commentsRes.json()) as any;
    const imported = commentsBody.comments.find((c: any) => c.body === "Looks risky here.");
    expect(imported).toBeTruthy();
    expect(imported.author.kind).toBe("human");
    expect(imported.author.name).toBe("octocat");

    // Verify comment_mirrors row is synced.
    const mirror = await getMirrorRow(db, imported.commentId, "github");
    expect(mirror?.status).toBe("synced");
    expect(mirror?.externalId).toBe(String(id(1)));
  });

  test("same review_comment webhook again → dedup (accepted: 0)", async () => {
    const payload = reviewCommentPayload(id(1), "Looks risky here.", "README.md", 3);
    const res = await app.request("/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "pull_request_review_comment",
        "x-hub-signature-256": sign(payload),
      },
      body: payload,
    });
    expect(res.status).toBe(200);
    expect((await res.json() as any).accepted).toBe(0);
  });

  test("unsigned payload → 401", async () => {
    const payload = reviewCommentPayload(id(2), "No sig.", "README.md", 3);
    const res = await app.request("/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "pull_request_review_comment",
      },
      body: payload,
    });
    expect(res.status).toBe(401);
  });

  test("wrong signature → 401", async () => {
    const payload = reviewCommentPayload(id(3), "Wrong sig.", "README.md", 3);
    const res = await app.request("/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "pull_request_review_comment",
        "x-hub-signature-256": sign(payload, "wrong-secret"),
      },
      body: payload,
    });
    expect(res.status).toBe(401);
  });

  test("issue_comment webhook → page-level Thread (no anchor)", async () => {
    const payload = issueCommentPayload(id(4), "Overall nice work.");
    const res = await app.request("/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "issue_comment",
        "x-hub-signature-256": sign(payload),
      },
      body: payload,
    });
    expect(res.status).toBe(200);
    expect((await res.json() as any).accepted).toBe(1);

    // Verify a page-level comment was created.
    const commentsRes = await app.request(`/sites/${siteSlug}/comments`);
    const commentsBody = (await commentsRes.json()) as any;
    const imported = commentsBody.comments.find((c: any) => c.body === "Overall nice work.");
    expect(imported).toBeTruthy();
    expect(imported.anchor).toBeNull();
  });

  test("echo loop: outbound-created comment arriving inbound → skipped", async () => {
    // The outbound dispatch creates a comment_mirrors row with the external id
    // of the bot-created GitHub comment. When the webhook fires for that same
    // external id (the echo), `mirrorExistsByExternal` returns true → skip.
    // We simulate this by inserting a mirror row for a "collab" origin comment,
    // then sending the webhook for the same external id.

    // First, create a Collab-origin comment via the outbound dispatch path
    // (we already have one from the outbound test — but that's a different test
    // suite. Let's just create a thread + mirror row manually.)
    const { createConversation, touchMirrorRow, getLatestVersionId } = await import("@collab/db");
    const { getSiteBySlug } = await import("@collab/db");
    const site = await getSiteBySlug(db, siteSlug);
    const latest = await getLatestVersionId(db, site!.id);
    const result = await createConversation(db, {
      siteId: site!.id,
      createdVersionId: latest!.id,
      pagePath: "README.md",
      visibility: "public",
      anchor: null,
      firstComment: {
        versionId: latest!.id,
        body: "Collab-origin comment",
        author: { name: "Jane", kind: "human", tier: "viewer", source: "native" },
        authorViewerId: null,
      },
    });
    // Simulate an outbound mirror row (origin=collab, externalId=id(5)).
    await touchMirrorRow(db, {
      commentId: result.firstCommentId,
      provider: "github",
      externalId: String(id(5)),
      externalUrl: "https://github.com/fake",
      status: "synced",
    });
// Now send a webhook with externalId=id(5) → should be deduped (mirrorExistsByExternal).

    const payload = reviewCommentPayload(id(5), "Echo loop comment.", "README.md", 3);
    const res = await app.request("/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "pull_request_review_comment",
        "x-hub-signature-256": sign(payload),
      },
      body: payload,
    });
    expect(res.status).toBe(200);
    expect((await res.json() as any).accepted).toBe(0);
  });

  test("deleted on a github-origin comment → tombstone", async () => {
    // The comment imported in the first test (externalId=id(1)) is github-origin.
    // Send a deleted webhook for it → the Collab comment should be tombstoned.
    const payload = deletedPayload(id(1));
    const res = await app.request("/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "pull_request_review_comment",
        "x-hub-signature-256": sign(payload),
      },
      body: payload,
    });
    expect(res.status).toBe(200);
    expect((await res.json() as any).accepted).toBe(1);

    // Verify the comment is now tombstoned (deletedAt set).
    const { schema } = await import("@collab/db");
    const { eq, isNull } = await import("drizzle-orm");
    const [row] = await db
      .select({ deletedAt: schema.comments.deletedAt })
      .from(schema.comments)
      .innerJoin(schema.commentMirrors, eq(schema.commentMirrors.commentId, schema.comments.id))
      .where(eq(schema.commentMirrors.externalId, String(id(1))))
      .limit(1);
    expect(row?.deletedAt).not.toBeNull();
  });

  test("deleted on a collab-origin mirror → detach (status=detached)", async () => {
    // The echo-loop test created a collab-origin comment with externalId=id(5).
    // Send a deleted webhook for it → the mirror should be detached, comment intact.
    const payload = deletedPayload(id(5));
    const res = await app.request("/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "pull_request_review_comment",
        "x-hub-signature-256": sign(payload),
      },
      body: payload,
    });
    expect(res.status).toBe(200);
    expect((await res.json() as any).accepted).toBe(1);

    // Verify the mirror row is detached (query by externalId since we don't
    // have the commentId directly).
    const { schema } = await import("@collab/db");
    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .select({ commentId: schema.commentMirrors.commentId, status: schema.commentMirrors.status })
      .from(schema.commentMirrors)
      .where(eq(schema.commentMirrors.externalId, String(id(5))))
      .limit(1);
    expect(row?.status).toBe("detached");

    // The Collab comment itself is NOT deleted (still has body "Collab-origin comment").
    const [cmt] = await db
      .select({ deletedAt: schema.comments.deletedAt })
      .from(schema.comments)
      .where(eq(schema.comments.id, row!.commentId))
      .limit(1);
    expect(cmt?.deletedAt).toBeNull();
  });

  test("webhook with no GITHUB_WEBHOOK_SECRET configured → 404", async () => {
    // Create an app without github config (no webhook secret).
    const sql2 = postgres(DB_URL!, { max: 1 });
    const db2 = drizzle(sql2, { schema }) as unknown as Db;
    const app2 = createApp({
      db: db2,
      store: new FsBlobStore(await mkdtemp(join(tmpdir(), "collab-blobs-nosig-"))),
      publicUrl: "http://content.test",
      viewerUrl: "http://viewer.test",
      // No github config → webhook secret is unset.
    });
    const res = await app2.request("/webhooks/github", {
      method: "POST",
      headers: { "content-type": "application/json", "x-github-event": "ping" },
      body: "{}",
    });
    expect(res.status).toBe(404);
    await sql2.end();
  });

  test("reconciliation poll imports missed comments", async () => {
    // Seed the fake GitHub API with a review comment that was "missed" by the
    // webhook (never delivered). The reconcile poller should pick it up.
    fakeApi.seedReviewComment(
      { owner: "octocat", name: "inbound-test" },
      1,
      {
        id: id(6),
        nodeId: "PRRC_3001",
        url: "https://github.com/octocat/inbound-test/pull/1#discussion_r3001",
        path: "README.md",
        line: 3,
        side: "RIGHT",
        commitId: HEAD_SHA,
        body: "Missed by webhook — imported via poll.",
      },
    );

    // Run the reconcile poller directly.
    const deps = {
      db,
      store: new FsBlobStore(blobDir),
      mirror: [new GitHubMirrorProvider({
        api: fakeApi,
        db,
        config: {
          appId: "1", appSlug: "collab", privateKeyPem: "fake",
          webhookSecret: WEBHOOK_SECRET, apiBase: "https://api.github.com",
          reconcileIntervalMs: 60_000,
        },
      })],
      github: {
        appId: "1", appSlug: "collab", privateKeyPem: "fake",
        webhookSecret: WEBHOOK_SECRET, apiBase: "https://api.github.com",
        reconcileIntervalMs: 60_000,
      },
    } as any;

    // Resolve the test's site id.
    const { getSiteBySlug } = await import("@collab/db");
    const site = await getSiteBySlug(db, siteSlug);
    expect(site).toBeTruthy();

    // Reconcile just this site (avoid hitting other tests' sites in the shared DB).
    const accepted = await reconcileOneSite(deps, site!.id, REPO, 1);
    expect(accepted).toBeGreaterThanOrEqual(1);

    // Verify the comment was imported.
    const commentsRes = await app.request(`/sites/${siteSlug}/comments`);
    const commentsBody = (await commentsRes.json()) as any;
    const imported = commentsBody.comments.find(
      (c: any) => c.body === "Missed by webhook — imported via poll.",
    );
    expect(imported).toBeTruthy();
    expect(imported.author.name).toBe("octocat");
  });

  test("pull_request_review_thread resolved webhook → Conversation resolved", async () => {
    // Create a Collab-origin Thread with a synced mirror row (as if it were
    // already mirrored outbound), then resolve it natively on GitHub.
    const { createConversation, touchMirrorRow, getLatestVersionId, getSiteBySlug, schema } =
      await import("@collab/db");
    const site = await getSiteBySlug(db, siteSlug);
    const latest = await getLatestVersionId(db, site!.id);
    const result = await createConversation(db, {
      siteId: site!.id,
      createdVersionId: latest!.id,
      pagePath: "README.md",
      visibility: "public",
      anchor: null,
      firstComment: {
        versionId: latest!.id,
        body: "Please fix this.",
        author: { name: "Jane", kind: "human", tier: "viewer", source: "native" },
        authorViewerId: null,
      },
    });
    await touchMirrorRow(db, {
      commentId: result.firstCommentId,
      provider: "github",
      externalId: String(id(20)),
      externalUrl: "https://github.com/fake",
      status: "synced",
    });

    const payload = threadResolvedPayload("resolved", id(20), "reviewer1");
    const res = await app.request("/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "pull_request_review_thread",
        "x-hub-signature-256": sign(payload),
      },
      body: payload,
    });
    expect(res.status).toBe(200);
    expect((await res.json() as any).accepted).toBe(1);

    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .select({ resolvedAt: schema.conversations.resolvedAt, resolvedBy: schema.conversations.resolvedBy })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, result.conversationId))
      .limit(1);
    expect(row?.resolvedAt).not.toBeNull();
    expect(row?.resolvedBy).toBe("reviewer1");

    // Re-sending the same resolved state is a no-op (accepted: 0).
    const res2 = await app.request("/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "pull_request_review_thread",
        "x-hub-signature-256": sign(payload),
      },
      body: payload,
    });
    expect((await res2.json() as any).accepted).toBe(0);

    // Unresolve → resolvedAt goes back to null.
    const unresolvePayload = threadResolvedPayload("unresolved", id(20), "reviewer1");
    const res3 = await app.request("/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "pull_request_review_thread",
        "x-hub-signature-256": sign(unresolvePayload),
      },
      body: unresolvePayload,
    });
    expect((await res3.json() as any).accepted).toBe(1);
    const [row2] = await db
      .select({ resolvedAt: schema.conversations.resolvedAt })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, result.conversationId))
      .limit(1);
    expect(row2?.resolvedAt).toBeNull();
  });

  test("reconciliation poll picks up a thread resolved natively on GitHub", async () => {
    // Create a Thread with a synced mirror row, mirroring what an outbound
    // dispatch would have produced.
    const { createConversation, touchMirrorRow, getLatestVersionId, getSiteBySlug, schema } =
      await import("@collab/db");
    const site = await getSiteBySlug(db, siteSlug);
    const latest = await getLatestVersionId(db, site!.id);
    const result = await createConversation(db, {
      siteId: site!.id,
      createdVersionId: latest!.id,
      pagePath: "README.md",
      visibility: "public",
      anchor: null,
      firstComment: {
        versionId: latest!.id,
        body: "Resolved via poll test.",
        author: { name: "Jane", kind: "human", tier: "viewer", source: "native" },
        authorViewerId: null,
      },
    });
    await touchMirrorRow(db, {
      commentId: result.firstCommentId,
      provider: "github",
      externalId: String(id(21)),
      externalUrl: "https://github.com/fake",
      status: "synced",
    });

    // Seed the fake API's thread state as already resolved (as if resolved
    // natively on GitHub, with no webhook delivered).
    fakeApi.seedReviewThread(
      { owner: "octocat", name: "inbound-test" },
      1,
      { id: `PRRT_${id(21)}`, isResolved: true, comments: [{ databaseId: id(21) }] },
    );

    const deps = {
      db,
      store: new FsBlobStore(blobDir),
      mirror: [new GitHubMirrorProvider({
        api: fakeApi,
        db,
        config: {
          appId: "1", appSlug: "collab", privateKeyPem: "fake",
          webhookSecret: WEBHOOK_SECRET, apiBase: "https://api.github.com",
          reconcileIntervalMs: 60_000,
        },
      })],
      github: {
        appId: "1", appSlug: "collab", privateKeyPem: "fake",
        webhookSecret: WEBHOOK_SECRET, apiBase: "https://api.github.com",
        reconcileIntervalMs: 60_000,
      },
    } as any;

    await reconcileOneSite(deps, site!.id, REPO, 1);

    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .select({ resolvedAt: schema.conversations.resolvedAt })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, result.conversationId))
      .limit(1);
    expect(row?.resolvedAt).not.toBeNull();
  });
});
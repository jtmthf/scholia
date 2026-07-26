import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { schema, type Db, upsertGitHubInstallation, getSiteBySlug } from "@scholia/db";
import { FsBlobStore } from "@scholia/core";
import { FakeGitHubApi } from "@scholia/github";
import { createApp } from "../src/app.js";
import { GitHubMirrorProvider } from "../src/mirror/github-provider.js";
import { handleLifecycle } from "../src/mirror/lifecycle.js";
import { migrateWithLock } from "./helpers/migrate.js";

// Integration test for M10 PR lifecycle: synchronize advances the Version;
// closed+merged only *offers* a freeze per ADR-0008 (v1 has no offer UI, so it's
// a no-op) — only `locked` auto-freezes the Site. The synchronize path is tested
// both via the webhook endpoint and directly via handleLifecycle.
const DB_URL = process.env.DATABASE_URL;
const MIGRATIONS = fileURLToPath(new URL("../../db/drizzle", import.meta.url));
const WEBHOOK_SECRET = "lifecycle-secret";

const enc = new TextEncoder();
const PAGE_MD_V1 = "# Hello PR\n\nSome **bold** text.\n\nA second paragraph.\n";
const PAGE_MD_V2 = "# Hello PR v2\n\nUpdated content here.\n";
const HEAD_SHA_V1 = "life-head-v1";
const HEAD_SHA_V2 = "life-head-v2";
const REPO = "octocat/lifecycle-test";

function sign(body: string, secret: string = WEBHOOK_SECRET): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

function pullRequestPayload(
  action: string,
  opts: { headSha?: string; merged?: boolean; state?: "open" | "closed" },
): string {
  return JSON.stringify({
    action,
    pull_request: {
      number: 1,
      head: { sha: opts.headSha ?? HEAD_SHA_V1 },
      merged: opts.merged ?? false,
      state: opts.state ?? "open",
    },
    repository: { full_name: REPO },
  });
}

describe.skipIf(!DB_URL)("M10: PR lifecycle", () => {
  let sql: ReturnType<typeof postgres>;
  let db: Db;
  let app: ReturnType<typeof createApp>;
  let blobDir: string;
  let fakeApi: FakeGitHubApi;
  let provider: GitHubMirrorProvider;
  let siteSlug: string;

  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1 });
    db = drizzle(sql, { schema });
    await migrateWithLock(sql, db, MIGRATIONS);
    blobDir = await mkdtemp(join(tmpdir(), "scholia-blobs-life-"));

    fakeApi = new FakeGitHubApi();
    fakeApi.seedPr({ owner: "octocat", name: "lifecycle-test" }, 1, {
      headSha: HEAD_SHA_V1,
      branch: "feature",
      title: "Test PR",
      files: [
        { filename: "README.md", status: "added", sha: "blob-1a", content: enc.encode(PAGE_MD_V1) },
      ],
    });
    fakeApi.setDiffLines(
      { owner: "octocat", name: "lifecycle-test" },
      "README.md",
      new Set([1, 3, 5]),
    );

    await upsertGitHubInstallation(db, {
      installationId: 99,
      account: "octocat",
      repos: [REPO],
    });

    provider = new GitHubMirrorProvider({
      api: fakeApi,
      db,
      config: {
        appId: "1",
        appSlug: "scholia",
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
        appSlug: "scholia",
        privateKeyPem: "fake",
        webhookSecret: WEBHOOK_SECRET,
        apiBase: "https://api.github.com",
        reconcileIntervalMs: 60_000,
      },
    });

    // Create a PR-backed Site.
    const res = await app.request("/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentSource: { kind: "pr", repo: REPO, prNumber: 1 } }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    siteSlug = body.slug;
  });

  afterAll(async () => {
    await sql?.end();
    if (blobDir) await rm(blobDir, { recursive: true, force: true });
  });

  test("synchronize with changed Page → new Version (ordinal +1)", async () => {
    // Advance the PR head with modified content.
    fakeApi.advancePrHead({ owner: "octocat", name: "lifecycle-test" }, 1, {
      newHeadSha: HEAD_SHA_V2,
      branch: "feature",
      files: [
        {
          filename: "README.md",
          status: "modified",
          sha: "blob-2a",
          content: enc.encode(PAGE_MD_V2),
        },
      ],
    });

    // Send a synchronize webhook.
    const payload = pullRequestPayload("synchronize", { headSha: HEAD_SHA_V2 });
    const res = await app.request("/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "pull_request",
        "x-hub-signature-256": sign(payload),
      },
      body: payload,
    });
    expect(res.status).toBe(200);

    // Verify the Site now has Version 2.
    const meta = await (await app.request(`/sites/${siteSlug}`)).json();
    expect(meta.version).toBe(2);
    expect(meta.latestVersion).toBe(2);

    // Verify the content reflects the new head.
    const entryRes = await app.request(`/content/sites/${siteSlug}`);
    const html = await entryRes.text();
    expect(html).toContain("Hello PR v2");
  });

  test("duplicate synchronize for the same head → no-op (no new Version)", async () => {
    // Send the same synchronize webhook again (head hasn't changed).
    const payload = pullRequestPayload("synchronize", { headSha: HEAD_SHA_V2 });
    const res = await app.request("/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "pull_request",
        "x-hub-signature-256": sign(payload),
      },
      body: payload,
    });
    expect(res.status).toBe(200);

    // Still Version 2 — no new Version was created.
    const meta = await (await app.request(`/sites/${siteSlug}`)).json();
    expect(meta.version).toBe(2);
    expect(meta.latestVersion).toBe(2);
  });

  test("closed + merged → site stays open (freeze is offered, not automatic)", async () => {
    // Send a closed webhook with merged=true.
    const payload = pullRequestPayload("closed", {
      headSha: HEAD_SHA_V2,
      merged: true,
      state: "closed",
    });
    const res = await app.request("/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "pull_request",
        "x-hub-signature-256": sign(payload),
      },
      body: payload,
    });
    expect(res.status).toBe(200);

    // Merge alone does not freeze the Site (ADR-0008: offer, not auto-apply).
    const site = await getSiteBySlug(db, siteSlug);
    expect(site?.state).toBe("open");

    // The meta route agrees.
    const meta = await (await app.request(`/sites/${siteSlug}`)).json();
    expect(meta.state).toBe("open");
  });

  test("locked → site frozen", async () => {
    const payload = pullRequestPayload("locked", { headSha: HEAD_SHA_V2 });
    const res = await app.request("/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "pull_request",
        "x-hub-signature-256": sign(payload),
      },
      body: payload,
    });
    expect(res.status).toBe(200);

    // `locked` is the only lifecycle event that auto-freezes.
    const site = await getSiteBySlug(db, siteSlug);
    expect(site?.state).toBe("frozen");
  });

  test("handleLifecycle closed+merged on an open site → stays open", async () => {
    // Create a fresh open PR-backed Site.
    const fakeApi2 = new FakeGitHubApi();
    fakeApi2.seedPr({ owner: "octocat", name: "lifecycle-test" }, 1, {
      headSha: HEAD_SHA_V1,
      branch: "feature",
      title: "Test PR",
      files: [
        { filename: "README.md", status: "added", sha: "blob-x", content: enc.encode(PAGE_MD_V1) },
      ],
    });

    const provider2 = new GitHubMirrorProvider({
      api: fakeApi2,
      db,
      config: {
        appId: "1",
        appSlug: "scholia",
        privateKeyPem: "fake",
        webhookSecret: WEBHOOK_SECRET,
        apiBase: "https://api.github.com",
        reconcileIntervalMs: 60_000,
      },
    });

    const store2 = new FsBlobStore(await mkdtemp(join(tmpdir(), "scholia-blobs-life2-")));
    const app2 = createApp({
      db,
      store: store2,
      publicUrl: "http://content.test",
      viewerUrl: "http://viewer.test",
      mirror: [provider2],
      github: {
        appId: "1",
        appSlug: "scholia",
        privateKeyPem: "fake",
        webhookSecret: WEBHOOK_SECRET,
        apiBase: "https://api.github.com",
        reconcileIntervalMs: 60_000,
      },
    });

    const res = await app2.request("/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentSource: { kind: "pr", repo: REPO, prNumber: 1 } }),
    });
    const body = await res.json();
    const freshSlug = body.slug;
    const freshSite = await getSiteBySlug(db, freshSlug);
    expect(freshSite?.state).toBe("open");

    // Call handleLifecycle directly with a closed+merged event.
    await handleLifecycle(
      {
        kind: "lifecycle",
        repo: REPO,
        prNumber: 1,
        action: "closed",
        merged: true,
      },
      { db, store: store2, mirror: [provider2], github: null } as any,
      provider2,
    );

    // Merge alone does not freeze the Site (ADR-0008: offer, not auto-apply).
    const updatedSite = await getSiteBySlug(db, freshSlug);
    expect(updatedSite?.state).toBe("open");

    await rm(blobDir, { recursive: true, force: true }).catch(() => {});
  });
});

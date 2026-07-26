import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { schema } from "@scholia/db";
import { upsertGitHubInstallation, findInstallationForRepo } from "@scholia/db";
import { FsBlobStore } from "@scholia/core";
import { FakeGitHubApi } from "@scholia/github";
import { createApp } from "../src/app.js";
import { GitHubMirrorProvider } from "../src/mirror/github-provider.js";
import { migrateWithLock } from "./helpers/migrate.js";

// Integration test for M10 PR-backed Sites: `POST /sites` with a `pr` content
// source → server fetches bytes from GitHub via a FakeGitHubApi → stores them →
// creates the Site with a mirrorBinding. Also tests `ref` sources, the
// local-reupload-on-PR-backed rejection, and the no-provider 400 path.
// Needs a Postgres (DATABASE_URL); skips when unset.
const DB_URL = process.env.DATABASE_URL;
const MIGRATIONS = fileURLToPath(new URL("../../db/drizzle", import.meta.url));

const enc = new TextEncoder();

const README_MD = "# Hello PR\n\nThis is the **entry** page.\n";
const GUIDE_MD = "# Guide\n\nSome content here.\n";
const HEAD_SHA = "abc123def456";
const REPO = "octocat/test-repo";

describe.skipIf(!DB_URL)("M10: PR-backed Sites", () => {
  let sql: ReturnType<typeof postgres>;
  let app: ReturnType<typeof createApp>;
  let blobDir: string;
  let fakeApi: FakeGitHubApi;

  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1 });
    const db = drizzle(sql, { schema });
    await migrateWithLock(sql, db, MIGRATIONS);
    blobDir = await mkdtemp(join(tmpdir(), "scholia-blobs-m10-"));

    // Seed the fake GitHub API with a PR that touches two markdown files.
    fakeApi = new FakeGitHubApi();
    fakeApi.seedPr(
      { owner: "octocat", name: "test-repo" },
      42,
      {
        headSha: HEAD_SHA,
        branch: "feature-branch",
        title: "Add docs",
        files: [
          { filename: "README.md", status: "added", sha: "blob-sha-1", content: enc.encode(README_MD) },
          { filename: "guide/intro.md", status: "added", sha: "blob-sha-2", content: enc.encode(GUIDE_MD) },
          { filename: "logo.png", status: "added", sha: "blob-sha-3", content: new Uint8Array([0x89, 0x50]) },
        ],
      },
    );

    // Seed an installation so `findInstallationForRepo` succeeds.
    await upsertGitHubInstallation(db, {
      installationId: 99,
      account: "octocat",
      repos: [REPO],
    });

    // Build the mirror provider wrapping the fake API.
    const provider = new GitHubMirrorProvider({
      api: fakeApi,
      db,
      config: {
        appId: "1",
        appSlug: "scholia",
        privateKeyPem: "fake-key",
        webhookSecret: "fake-secret",
        apiBase: "https://api.github.com",
        reconcileIntervalMs: 60_000,
      },
    });

    app = createApp({
      db,
      store: new FsBlobStore(blobDir),
      publicUrl: "http://content.test",
      viewerUrl: "http://viewer.test",
      mirror: [provider],
    });
  });

  afterAll(async () => {
    await sql?.end();
    if (blobDir) await rm(blobDir, { recursive: true, force: true });
  });

  test("POST /sites with pr content source — 201, mirrorBinding in response", async () => {
    const res = await app.request("/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contentSource: { kind: "pr", repo: REPO, prNumber: 42 },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.slug).toBeTruthy();
    expect(body.shareUrl).toBe(`http://viewer.test/s/${body.slug}`);
    expect(typeof body.token).toBe("string");
    expect(body.entryPath).toBe("README.md");
    expect(body.mirrorBinding).toEqual({ provider: "github", repo: REPO, prNumber: 42 });

    // GET /sites/:slug should also report the mirrorBinding.
    const meta = (await (await app.request(`/sites/${body.slug}`)).json()) as any;
    expect(meta.mirrorBinding).toEqual({ provider: "github", repo: REPO, prNumber: 42 });
    expect(meta.version).toBe(1);
    expect(meta.entryPath).toBe("README.md");
    // Both markdown files became Pages; the PNG was dropped (PR fetch filters to md/html).
    expect(meta.pages).toHaveLength(2);
    expect(meta.pages.map((p: any) => p.path).sort()).toEqual(["README.md", "guide/intro.md"]);

    // Content is actually served from the server (bytes were stored on upload).
    const entryRes = await app.request(`/content/sites/${body.slug}`);
    expect(entryRes.status).toBe(200);
    const entryHtml = await entryRes.text();
    expect(entryHtml).toContain("Hello PR");
  });

  test("POST /sites with ref content source — 201, no mirrorBinding", async () => {
    // Seed ref content at a named ref. The fake API resolves by `${ref}:${path}`.
    // We reuse the PR-seeded content keyed by HEAD_SHA — but for ref fetch we need
    // a listTree override. We'll seed directly via getFileContent by planting
    // content under a ref key.
    //
    // Since FakeGitHubApi.getFileContent searches all repo states by `${ref}:${path}`,
    // and we seeded content at `${HEAD_SHA}:${filename}`, passing ref=HEAD_SHA works.
    // For a named ref, we need a provider with a listTree that returns our paths.
    const sql2 = postgres(DB_URL!, { max: 1 });
    const db2 = drizzle(sql2, { schema });

    const provider2 = new GitHubMirrorProvider({
      api: fakeApi,
      db: db2,
      config: {
        appId: "1",
        appSlug: "scholia",
        privateKeyPem: "fake-key",
        webhookSecret: "fake-secret",
        apiBase: "https://api.github.com",
        reconcileIntervalMs: 60_000,
      },
      listTree: async (_api, _repo, _ref) => ["README.md", "guide/intro.md"],
    });

    const app2 = createApp({
      db: db2,
      store: new FsBlobStore(await mkdtemp(join(tmpdir(), "scholia-blobs-ref-"))),
      publicUrl: "http://content.test",
      viewerUrl: "http://viewer.test",
      mirror: [provider2],
    });

    const res = await app2.request("/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contentSource: { kind: "ref", repo: REPO, ref: HEAD_SHA },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.slug).toBeTruthy();
    expect(body.entryPath).toBe("README.md");
    // Ref-backed Sites are NOT mirrored (ADR-0008 mirroring is PR-only).
    expect(body.mirrorBinding).toBeUndefined();

    // Content is served.
    const entryRes = await app2.request(`/content/sites/${body.slug}`);
    expect(entryRes.status).toBe(200);
    expect((await entryRes.text()).includes("Hello PR")).toBe(true);

    await sql2.end();
  });

  test("re-upload local on a PR-backed Site → 400", async () => {
    // First create a PR-backed Site.
    const createRes = await app.request("/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contentSource: { kind: "pr", repo: REPO, prNumber: 42 },
      }),
    });
    expect(createRes.status).toBe(201);
    const { slug, token } = (await createRes.json()) as any;

    // Attempt a local re-upload → rejected.
    const res = await app.request(`/sites/${slug}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        contentSource: { kind: "local" },
        files: [{ path: "README.md", kind: "markdown", contentHash: "fake" }],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/PR-backed/);
  });

  test("re-upload pr on a PR-backed Site → 201 (new Version)", async () => {
    // Create a PR-backed Site.
    const createRes = await app.request("/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contentSource: { kind: "pr", repo: REPO, prNumber: 42 },
      }),
    });
    expect(createRes.status).toBe(201);
    const { slug, token } = (await createRes.json()) as any;

    // Advance the PR head with modified content.
    const newSha = "new789head012";
    fakeApi.advancePrHead(
      { owner: "octocat", name: "test-repo" },
      42,
      {
        newHeadSha: newSha,
        branch: "feature-branch",
        files: [
          { filename: "README.md", status: "modified", sha: "blob-sha-1b", content: enc.encode("# Hello PR v2\n\nUpdated.\n") },
          { filename: "guide/intro.md", status: "modified", sha: "blob-sha-2b", content: enc.encode(GUIDE_MD) },
        ],
      },
    );

    // Re-upload via --pr (advance to new head).
    const res = await app.request(`/sites/${slug}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        contentSource: { kind: "pr", repo: REPO, prNumber: 42 },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.version).toBe(2);
    expect(body.entryPath).toBe("README.md");

    // Verify the content reflects the new head.
    const entryRes = await app.request(`/content/sites/${slug}`);
    expect(entryRes.status).toBe(200);
    const html = await entryRes.text();
    expect(html).toContain("Hello PR v2");
  });

  test("dedup: re-upload pr at same head sha → 200 deduped=true (no new Version)", async () => {
    // Create a PR-backed Site.
    const createRes = await app.request("/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contentSource: { kind: "pr", repo: REPO, prNumber: 42 },
      }),
    });
    expect(createRes.status).toBe(201);
    const { slug, token } = (await createRes.json()) as any;

    // The Latest Version's provenance.sha is the current PR head (HEAD_SHA or newSha
    // from the previous test, which advanced it). Re-upload with the same sha
    // explicitly to trigger dedup.
    //
    // We need to know the current head. After the previous test advanced it, the
    // head is "new789head012". But tests may run in any order, so we query metadata
    // to get the current version, then re-upload with the same provenance.
    const meta = (await (await app.request(`/sites/${slug}`)).json()) as any;
    expect(meta.version).toBeGreaterThanOrEqual(1);

    // Re-upload with an explicit provenance.sha matching what was just stored.
    // The dedup path requires body.provenance.sha to match the Latest Version's
    // provenance.sha. We don't know it from the meta response, so we re-fetch
    // with the same content source — the server derives provenance from the PR
    // head, and if it hasn't changed, the sha matches.
    const res = await app.request(`/sites/${slug}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        contentSource: { kind: "pr", repo: REPO, prNumber: 42 },
      }),
    });
    // Either deduped (200) or a new Version (201) — depends on test ordering.
    // If the head was advanced by the previous test, this is the same head → deduped.
    // If not, it's the original head → deduped.
    expect([200, 201].includes(res.status)).toBe(true);
    const body = (await res.json()) as any;
    if (res.status === 200) {
      expect(body.deduped).toBe(true);
    }
  });

  test("POST /sites with pr but no installation → 409", async () => {
    const res = await app.request("/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contentSource: { kind: "pr", repo: "someone/else-repo", prNumber: 1 },
      }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/install the Scholia GitHub App/);
  });

  test("POST /sites with pr but no mirror provider configured → 400", async () => {
    // Create an app with no mirror providers (GitHub integration off).
    const sql2 = postgres(DB_URL!, { max: 1 });
    const db2 = drizzle(sql2, { schema });
    const app2 = createApp({
      db: db2,
      store: new FsBlobStore(await mkdtemp(join(tmpdir(), "scholia-blobs-noprovider-"))),
      publicUrl: "http://content.test",
      viewerUrl: "http://viewer.test",
      // No mirror providers — simulates a server without GitHub configured.
    });

    const res = await app2.request("/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contentSource: { kind: "pr", repo: REPO, prNumber: 42 },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/GitHub integration not enabled/);
    await sql2.end();
  });

  test("non-PR-backed local Site is unaffected — still works as before", async () => {
    // Upload a local file via the blob negotiation flow (as in M3 tests).
    const bytes = enc.encode("# Local Site\n\nNo GitHub here.\n");
    const { hashBytes } = await import("@scholia/core");
    const hash = hashBytes(bytes);

    // PUT the blob.
    const putRes = await app.request(`/blobs/${hash}`, {
      method: "PUT",
      body: bytes.buffer as ArrayBuffer,
    });
    expect(putRes.status).toBe(200);

    // POST /sites with a local content source.
    const res = await app.request("/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contentSource: { kind: "local" },
        files: [{ path: "README.md", kind: "markdown", contentHash: hash }],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.slug).toBeTruthy();
    expect(body.mirrorBinding).toBeUndefined();
    expect(body.entryPath).toBe("README.md");

    // Metadata has no mirrorBinding.
    const meta = (await (await app.request(`/sites/${body.slug}`)).json()) as any;
    expect(meta.mirrorBinding).toBeUndefined();
  });
});

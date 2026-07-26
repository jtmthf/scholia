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

// Integration test for M6: re-upload → new Version, cross-Version anchor
// migration (live vs Outdated), per-Version permalinks, source Diff, Last Seen +
// summary counts. Same harness as M3/M5 — needs Postgres (DATABASE_URL) + an
// FsBlobStore temp dir; skips when no DATABASE_URL is configured.
const DB_URL = process.env.DATABASE_URL;
const MIGRATIONS = fileURLToPath(new URL("../../db/drizzle", import.meta.url));

const enc = new TextEncoder();

// v1: two anchorable spans + a second Page. v2: keeps "quick brown fox", drops
// "line to be deleted", and removes extra.md.
const README_V1 = "# Title\n\nThe quick brown fox jumps.\n\nA line to be deleted.\n";
const README_V2 = "# Title\n\nThe quick brown fox jumps.\n\nA brand new line.\n";
const EXTRA_V1 = "# Extra\n\nThis page goes away in v2.\n";

describe.skipIf(!DB_URL)("M6: Versioning UX", () => {
  let sql: ReturnType<typeof postgres>;
  let app: ReturnType<typeof createApp>;
  let blobDir: string;

  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1 });
    const db = drizzle(sql, { schema });
    await migrateWithLock(sql, db, MIGRATIONS);
    blobDir = await mkdtemp(join(tmpdir(), "scholia-blobs-m6-"));
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

  // PUT every blob then submit the manifest — either creating a Site (no token)
  // or appending a Version (owner token). Returns the parsed JSON response.
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
      await app.request(`/blobs/${h}`, { method: "PUT", body: enc.encode(f.text).buffer });
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
      { path: "README.md", kind: "markdown", text: README_V1 },
      { path: "extra.md", kind: "markdown", text: EXTRA_V1 },
    ]);
    expect(status).toBe(201);
    return { slug: body.slug, token: body.token };
  }

  async function mintViewer(slug: string): Promise<string> {
    const res = await json(`/sites/${slug}/viewers`, "POST");
    return ((await res.json()) as { viewerId: string }).viewerId;
  }

  async function anchoredThread(slug: string, viewerId: string, path: string, exact: string) {
    const res = await json(`/sites/${slug}/conversations`, "POST", {
      pagePath: path,
      anchor: { textQuote: { exact }, smIds: [1] },
      body: `comment on "${exact}"`,
      viewerId,
      displayName: "Jane",
    });
    expect(res.status).toBe(201);
    return await res.json();
  }

  test("re-upload creates a new Version and migrates anchors (live vs Outdated)", async () => {
    const { slug, token } = await makeSite();
    const viewerId = await mintViewer(slug);

    // A: survives to v2; B: its quote is removed in v2; page-level on extra.md
    // which is removed entirely.
    const convA = await anchoredThread(slug, viewerId, "README.md", "quick brown fox");
    const convB = await anchoredThread(slug, viewerId, "README.md", "line to be deleted");
    const pageConv = await (
      await json(`/sites/${slug}/conversations`, "POST", {
        pagePath: "extra.md",
        anchor: null,
        body: "page-level on a doomed page",
        viewerId,
        displayName: "Jane",
      })
    ).json();

    // Re-upload v2 (drops extra.md, rewrites the deleted line).
    const v2 = await upload([{ path: "README.md", kind: "markdown", text: README_V2 }], {
      slug,
      token,
    });
    expect(v2.status).toBe(201);
    expect(v2.body.version).toBe(2);
    expect(v2.body.migration.outdated).toBeGreaterThanOrEqual(2);

    // README threads: A stays live, B goes Outdated.
    const readmeConvs = (await (
      await app.request(`/sites/${slug}/conversations?path=README.md&viewerId=${viewerId}`)
    ).json()) as any[];
    const a = readmeConvs.find((c) => c.id === convA.id);
    const b = readmeConvs.find((c) => c.id === convB.id);
    expect(a.anchorStatus).toBe("live");
    expect(a.anchor.sourceRange).toBeUndefined(); // stale range dropped on migrate
    expect(b.anchorStatus).toBe("outdated");
    expect(b.createdOrdinal).toBe(1);

    // Page-level thread on the removed Page → Outdated.
    const extraConvs = (await (
      await app.request(`/sites/${slug}/conversations?path=extra.md&viewerId=${viewerId}`)
    ).json()) as any[];
    expect(extraConvs.find((c) => c.id === pageConv.id).anchorStatus).toBe("outdated");
  });

  test("owner-token gate on re-upload (401 missing, 403 wrong)", async () => {
    const { slug } = await makeSite();
    const noAuth = await upload([{ path: "README.md", kind: "markdown", text: README_V2 }], {
      slug,
    });
    expect(noAuth.status).toBe(401);
    const badAuth = await upload([{ path: "README.md", kind: "markdown", text: README_V2 }], {
      slug,
      token: "not-a-real-token",
    });
    expect(badAuth.status).toBe(403);
  });

  test("version list + per-Version permalink metadata", async () => {
    const { slug, token } = await makeSite();
    await upload([{ path: "README.md", kind: "markdown", text: README_V2 }], { slug, token });

    const { versions } = await (await app.request(`/sites/${slug}/versions`)).json();
    expect(versions).toHaveLength(2);
    expect(versions[0].ordinal).toBe(2);
    expect(versions[0].isLatest).toBe(true);

    // Latest metadata.
    const latest = await (await app.request(`/sites/${slug}`)).json();
    expect(latest.version).toBe(2);
    expect(latest.latestVersion).toBe(2);
    expect(latest.isLatest).toBe(true);

    // Pinned v1: read-only historical view.
    const v1 = await (await app.request(`/sites/${slug}?v=1`)).json();
    expect(v1.version).toBe(1);
    expect(v1.latestVersion).toBe(2);
    expect(v1.isLatest).toBe(false);
    expect(v1.contentBase).toContain(`/content/sites/${slug}/v/1`);
    // extra.md exists at v1 but not at latest.
    expect(v1.pages.map((p: any) => p.path)).toContain("extra.md");

    // Version-pinned content serves the historical Page.
    const c1 = await app.request(`/content/sites/${slug}/v/1/extra.md`);
    expect(c1.status).toBe(200);
    expect(await c1.text()).toContain("goes away");
    // …and extra.md is gone from Latest content.
    expect((await app.request(`/content/sites/${slug}/extra.md`)).status).toBe(404);
  });

  test("source-level Diff: changed-Pages summary + per-Page hunks", async () => {
    const { slug, token } = await makeSite();
    await upload([{ path: "README.md", kind: "markdown", text: README_V2 }], { slug, token });

    const summary = await (await app.request(`/sites/${slug}/diff?from=1&to=2`)).json();
    const readme = summary.pages.find((p: any) => p.path === "README.md");
    const extra = summary.pages.find((p: any) => p.path === "extra.md");
    expect(readme.status).toBe("modified");
    expect(extra.status).toBe("removed");

    const page = await (await app.request(`/sites/${slug}/diff?from=1&to=2&path=README.md`)).json();
    expect(page.status).toBe("modified");
    expect(page.diff.added).toBeGreaterThanOrEqual(1);
    expect(page.diff.removed).toBeGreaterThanOrEqual(1);
    const delLine = page.diff.lines.find((l: any) => l.type === "del");
    expect(delLine.text).toContain("line to be deleted");
  });

  test("Last Seen + summary counts", async () => {
    const { slug, token } = await makeSite();
    const viewerId = await mintViewer(slug);

    // Record Last Seen at v1, then upload v2.
    const ls = await json(`/sites/${slug}/last-seen`, "PUT", { viewerId, version: 1 });
    expect(ls.status).toBe(200);
    await upload([{ path: "README.md", kind: "markdown", text: README_V2 }], { slug, token });

    const summary = await (await app.request(`/sites/${slug}/summary?viewerId=${viewerId}`)).json();
    expect(summary.latestVersion).toBe(2);
    expect(summary.lastSeenVersion).toBe(1);
    expect(summary.newVersions).toBe(1);

    // A fresh Viewer with no Last Seen has nothing new.
    const other = await mintViewer(slug);
    const s2 = await (await app.request(`/sites/${slug}/summary?viewerId=${other}`)).json();
    expect(s2.newVersions).toBe(0);
  });
});

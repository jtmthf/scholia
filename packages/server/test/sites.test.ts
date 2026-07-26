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

// Integration test for the M3 Sites milestone: blob negotiation + manifest
// upload + multi-page content serving. Needs a Postgres (DATABASE_URL); the
// blob store is an FsBlobStore in a temp dir so MinIO isn't required. Skips
// when no DATABASE_URL is configured (e.g. bare `pnpm test` with no docker).
const DB_URL = process.env.DATABASE_URL;
const MIGRATIONS = fileURLToPath(new URL("../../db/drizzle", import.meta.url));

const enc = new TextEncoder();

const README_MD = "# Hello M3\n\nThis is the **entry** page.\n";
const INTRO_MD = "# Intro\n\nSee [the README](../README.md) or [an image](../logo.png).\n";
// Small PNG (1x1 transparent pixel).
const LOGO_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

describe.skipIf(!DB_URL)("M3: Sites — folders/zips", () => {
  let sql: ReturnType<typeof postgres>;
  let app: ReturnType<typeof createApp>;
  let blobDir: string;

  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1 });
    const db = drizzle(sql, { schema });
    await migrateWithLock(sql, db, MIGRATIONS);
    blobDir = await mkdtemp(join(tmpdir(), "scholia-blobs-m3-"));
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

  // Upload files via the blob negotiation flow, then POST /sites.
  async function uploadSite(
    files: Array<{ path: string; kind: "markdown" | "html" | "asset"; bytes: Uint8Array }>,
  ) {
    const entries = files.map((f) => ({
      path: f.path,
      kind: f.kind,
      contentHash: hashBytes(f.bytes),
    }));

    // 1. Diff to discover which blobs are missing.
    const diffRes = await app.request("/blobs/diff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hashes: entries.map((e) => e.contentHash) }),
    });
    expect(diffRes.status).toBe(200);
    const { missing } = (await diffRes.json()) as { missing: string[] };

    // 2. PUT each missing blob.
    for (const hash of missing) {
      const file = files.find((f) => hashBytes(f.bytes) === hash)!;
      const putRes = await app.request(`/blobs/${hash}`, {
        method: "PUT",
        body: file.bytes.buffer as ArrayBuffer,
      });
      expect(putRes.status).toBe(200);
    }

    // 3. POST /sites with the manifest.
    return app.request("/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentSource: { kind: "local" }, files: entries }),
    });
  }

  test("single markdown file — 201, share URL, token, entryPath", async () => {
    const res = await uploadSite([
      { path: "README.md", kind: "markdown", bytes: enc.encode(README_MD) },
    ]);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.slug).toBeTruthy();
    expect(body.shareUrl).toBe(`http://viewer.test/s/${body.slug}`);
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(20);
    expect(body.entryPath).toBe("README.md");
  });

  test("multi-page folder — nav, entryPath, contentBase, content", async () => {
    const res = await uploadSite([
      { path: "README.md", kind: "markdown", bytes: enc.encode(README_MD) },
      { path: "guide/intro.md", kind: "markdown", bytes: enc.encode(INTRO_MD) },
      { path: "logo.png", kind: "asset", bytes: LOGO_PNG },
    ]);
    expect(res.status).toBe(201);
    const { slug } = await res.json();

    // Metadata
    const meta = await (await app.request(`/sites/${slug}`)).json();
    expect(meta.slug).toBe(slug);
    expect(meta.state).toBe("open");
    expect(meta.version).toBe(1);
    expect(meta.entryPath).toBe("README.md");
    expect(meta.contentBase).toBe(`http://content.test/content/sites/${slug}`);
    // README floats first in the nav.
    expect(meta.nav[0].title).toBe("Hello M3");
    // Pages list includes all entries.
    expect(meta.pages).toHaveLength(3);
    expect(meta.pages.find((p: any) => p.path === "logo.png")?.kind).toBe("asset");

    // Entry page (README.md)
    const entryRes = await app.request(`/content/sites/${slug}`);
    expect(entryRes.status).toBe(200);
    expect(entryRes.headers.get("x-robots-tag")).toBe("noindex");
    expect(entryRes.headers.get("referrer-policy")).toBe("no-referrer");
    const entryHtml = await entryRes.text();
    expect(entryHtml).toContain("Hello M3");
    expect(entryHtml).toContain("data-sm=");

    // Specific markdown page with source map stamps and link rewriting.
    const introRes = await app.request(`/content/sites/${slug}/guide/intro.md`);
    expect(introRes.status).toBe(200);
    const introHtml = await introRes.text();
    expect(introHtml).toContain("data-sm=");
    // Inter-page link to README.md is rewritten to the viewer URL.
    expect(introHtml).toContain(`http://viewer.test/s/${slug}/README.md`);
    expect(introHtml).toContain('target="_top"');
    // Asset link (logo.png) is NOT rewritten.
    expect(introHtml).not.toContain(`http://viewer.test/s/${slug}/logo.png`);

    // Asset served raw with correct content-type.
    const assetRes = await app.request(`/content/sites/${slug}/logo.png`);
    expect(assetRes.status).toBe(200);
    expect(assetRes.headers.get("content-type")).toContain("image/png");
    expect(assetRes.headers.get("x-robots-tag")).toBe("noindex");
  });

  test("HTML Page — entry precedence, served with CSP + noindex + bridge + data-sm", async () => {
    const INDEX_HTML =
      `<!doctype html><html><head><title>HTML Home</title></head>` +
      `<body><h1>HTML Home</h1><p>Hosted <a href="README.md">markdown</a>.</p>` +
      `<script>window.__ok=1</script></body></html>`;
    const res = await uploadSite([
      { path: "index.html", kind: "html", bytes: enc.encode(INDEX_HTML) },
      { path: "README.md", kind: "markdown", bytes: enc.encode(README_MD) },
    ]);
    expect(res.status).toBe(201);
    const { slug } = await res.json();

    // index.html wins entry precedence (CONTEXT "Entry Page", restored in M4).
    const meta = await (await app.request(`/sites/${slug}`)).json();
    expect(meta.entryPath).toBe("index.html");
    expect(meta.pages.find((p: any) => p.path === "index.html")?.kind).toBe("html");
    // HTML Pages appear in the Nav alongside Markdown Pages.
    expect(meta.nav.map((n: any) => n.title)).toContain("HTML Home");

    // The HTML Page is served as a document into the iframe.
    const entryRes = await app.request(`/content/sites/${slug}`);
    expect(entryRes.status).toBe(200);
    expect(entryRes.headers.get("content-type")).toContain("text/html");
    expect(entryRes.headers.get("x-robots-tag")).toBe("noindex");
    expect(entryRes.headers.get("referrer-policy")).toBe("no-referrer");
    // CSP: framing pinned to the viewer origin (PLAN §2).
    const csp = entryRes.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("frame-ancestors http://viewer.test");
    expect(csp).toContain("default-src 'self'");

    const entryHtml = await entryRes.text();
    expect(entryHtml).toContain("HTML Home");
    // Uploaded script preserved (ADR-0003), data-sm stamped, bridge injected.
    expect(entryHtml).toContain("window.__ok=1");
    expect(entryHtml).toContain("data-sm=");
    expect(entryHtml).toContain("scholia-bridge");
    expect(entryHtml).toContain('name="robots"');
    // Inter-page link to the Markdown Page is rewritten to the viewer route.
    expect(entryHtml).toContain(`http://viewer.test/s/${slug}/README.md`);
  });

  test("POST /sites with a missing blob → 409", async () => {
    const fakeHash = hashBytes(enc.encode("not-uploaded-" + Math.random()));
    const res = await app.request("/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contentSource: { kind: "local" },
        files: [{ path: "doc.md", kind: "markdown", contentHash: fakeHash }],
      }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(Array.isArray(body.missing)).toBe(true);
    expect(body.missing).toHaveLength(1);
  });

  test("PUT /blobs/:hash with mismatched bytes → 400", async () => {
    const bytes = enc.encode("hello world");
    const correctHash = hashBytes(bytes);
    const wrongBytes = enc.encode("different content");
    const res = await app.request(`/blobs/${correctHash}`, {
      method: "PUT",
      body: wrongBytes.buffer,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/mismatch/i);
  });

  test("POST /sites rejects malformed body", async () => {
    const res = await app.request("/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nope: true }),
    });
    expect(res.status).toBe(400);
  });

  test("unknown slug 404s on metadata and content", async () => {
    expect((await app.request("/sites/nope-nope-nope")).status).toBe(404);
    expect((await app.request("/content/sites/nope-nope-nope")).status).toBe(404);
  });
});

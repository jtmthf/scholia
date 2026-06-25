import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { schema } from "@collab/db";
import { FsBlobStore } from "@collab/core";
import { createApp } from "../src/app.js";

// Integration test for the M2 tracer bullet: CLI body -> API -> blob store ->
// content origin -> iframe document. Needs a Postgres (DATABASE_URL); the blob
// store is an FsBlobStore in a temp dir so MinIO isn't required. Skips when no
// DATABASE_URL is configured (e.g. a bare `pnpm test` with no docker).
const DB_URL = process.env.DATABASE_URL;
const MIGRATIONS = fileURLToPath(new URL("../../db/drizzle", import.meta.url));

const SAMPLE = "# Hello M2\n\nThis page is **hosted**.\n\n> [!NOTE]\n> A note.\n";

describe.skipIf(!DB_URL)("M2: share -> host -> view", () => {
  let sql: ReturnType<typeof postgres>;
  let app: ReturnType<typeof createApp>;
  let blobDir: string;

  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1 });
    const db = drizzle(sql, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    blobDir = await mkdtemp(join(tmpdir(), "collab-blobs-"));
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

  async function share(filename = "README.md", content = SAMPLE) {
    const res = await app.request("/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename, content }),
    });
    return res;
  }

  test("POST /sites creates a Site and returns a Share URL + owner token", async () => {
    const res = await share();
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.slug).toBeTruthy();
    expect(body.shareUrl).toBe(`http://viewer.test/s/${body.slug}`);
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(20);
    expect(body.page.title).toBe("Hello M2");
  });

  test("POST /sites rejects a malformed body", async () => {
    const res = await app.request("/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nope: true }),
    });
    expect(res.status).toBe(400);
  });

  test("GET /sites/:slug returns metadata with the content URL", async () => {
    const { slug } = (await (await share()).json()) as any;
    const res = await app.request(`/sites/${slug}`);
    expect(res.status).toBe(200);
    const meta = (await res.json()) as any;
    expect(meta.slug).toBe(slug);
    expect(meta.state).toBe("open");
    expect(meta.version).toBe(1);
    expect(meta.page.kind).toBe("markdown");
    expect(meta.page.contentUrl).toBe(`http://content.test/content/sites/${slug}`);
  });

  test("GET /content/sites/:slug serves the rendered Page as a noindex document", async () => {
    const { slug } = (await (await share()).json()) as any;
    const res = await app.request(`/content/sites/${slug}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const html = await res.text();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('class="markdown-body"');
    expect(html).toContain("Hello M2");
    // The Source Map stamps survive into the served document (for M5 anchoring).
    expect(html).toContain("data-sm=");
    // GitHub alert rendered.
    expect(html).toContain("markdown-alert");
  });

  test("unknown slug 404s on both metadata and content", async () => {
    expect((await app.request("/sites/nope")).status).toBe(404);
    expect((await app.request("/content/sites/nope")).status).toBe(404);
  });
});

import { describe, expect } from "vitest";
import { test } from "../helpers/tmp.js";
import { ingestMarkdown } from "../../src/ingest/markdown.js";
import { storeMarkdownPage } from "../../src/ingest/store.js";
import { FsBlobStore, hashBytes } from "../../src/blob/index.js";
import { SOURCE_MAP_VERSION } from "../../src/ingest/source-map.js";

const enc = new TextEncoder();

describe("ingestMarkdown (render + Source Map)", () => {
  test("renders HTML and derives the title like the shared pipeline", async () => {
    const { html, title } = await ingestMarkdown("# Welcome\n\nHello world.\n");
    expect(title).toBe("Welcome");
    expect(html).toContain("Hello world.");
  });

  test("stamps data-sm ids and maps them to source offsets", async () => {
    const source = "# Title\n\nA paragraph.\n";
    const { html, sourceMap } = await ingestMarkdown(source);

    expect(sourceMap.version).toBe(SOURCE_MAP_VERSION);
    expect(sourceMap.entries.length).toBeGreaterThan(0);
    expect(html).toContain('data-sm="0"');

    // Every entry's range must point at real source, and the heading entry's
    // slice must contain the heading text.
    for (const e of sourceMap.entries) {
      expect(e.end).toBeGreaterThan(e.start);
      expect(e.start).toBeGreaterThanOrEqual(0);
      expect(e.end).toBeLessThanOrEqual(source.length);
    }
    const h1 = sourceMap.entries.find((e) => e.tag === "h1");
    expect(h1).toBeDefined();
    expect(source.slice(h1!.start, h1!.end)).toContain("Title");
  });
});

describe("storeMarkdownPage (content-addressed blobs)", () => {
  test("writes source, rendered HTML, and Source Map by hash", async ({ tmp }) => {
    const store = new FsBlobStore(tmp.root);
    const source = "# Doc\n\nbody\n";

    const stored = await storeMarkdownPage(store, source);

    // The source blob hash is exactly sha256 of the raw source.
    expect(stored.contentHash).toBe(hashBytes(enc.encode(source)));
    expect(stored.title).toBe("Doc");

    // All three artifacts are retrievable; the rendered blob is HTML.
    for (const hash of [stored.contentHash, stored.renderedHash, stored.sourceMapHash]) {
      expect(await store.has(hash)).toBe(true);
    }
    const rendered = new TextDecoder().decode((await store.get(stored.renderedHash))!);
    expect(rendered).toContain("body");

    const sm = JSON.parse(new TextDecoder().decode((await store.get(stored.sourceMapHash))!));
    expect(sm.version).toBe(SOURCE_MAP_VERSION);
  });

  test("is idempotent by content hash on re-store", async ({ tmp }) => {
    const store = new FsBlobStore(tmp.root);
    const a = await storeMarkdownPage(store, "# Same\n");
    const b = await storeMarkdownPage(store, "# Same\n");
    expect(b.contentHash).toBe(a.contentHash);
    expect(b.renderedHash).toBe(a.renderedHash);
    expect(b.sourceMapHash).toBe(a.sourceMapHash);
  });
});

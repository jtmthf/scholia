import { describe, test, expect } from "vitest";
import { ingestHtml } from "../../src/ingest/html.js";
import { SOURCE_MAP_VERSION } from "../../src/ingest/source-map.js";

describe("ingestHtml (M4)", () => {
  test("stamps data-sm on body elements with correct source offsets", () => {
    const source = `<!doctype html><html><head><title>Doc</title></head><body><p>Hello <strong>world</strong></p></body></html>`;
    const { html, sourceMap } = ingestHtml(source);

    expect(sourceMap.version).toBe(SOURCE_MAP_VERSION);
    // The <p> and <strong> are stamped; structural/head elements are not.
    const tags = sourceMap.entries.map((e) => e.tag).sort();
    expect(tags).toEqual(["p", "strong"]);

    // Every entry's source slice covers the element's markup.
    const p = sourceMap.entries.find((e) => e.tag === "p")!;
    const slice = source.slice(p.start, p.end);
    expect(slice.startsWith("<p>")).toBe(true);
    expect(slice.endsWith("</p>")).toBe(true);

    // The served HTML carries the data-sm stamps for anchoring.
    expect(html).toContain(`data-sm="${p.id}"`);
  });

  test("title comes from <title>, falling back to the first <h1>", () => {
    expect(ingestHtml(`<title>From Title</title><h1>From H1</h1>`).title).toBe("From Title");
    expect(ingestHtml(`<body><h1>Only H1</h1><p>x</p></body>`).title).toBe("Only H1");
    expect(ingestHtml(`<p>no headings</p>`).title).toBeUndefined();
  });

  test("preserves uploaded scripts (ADR-0003 — interactivity is not stripped)", () => {
    const { html } = ingestHtml(`<body><button id="b">x</button><script>document.title="hi"</script></body>`);
    expect(html).toContain("<script>");
    expect(html).toContain(`document.title="hi"`);
  });

  test("collects headings with depth and ids", () => {
    const { headings } = ingestHtml(`<h1>Top</h1><h2 id="sub">Sub</h2>`);
    expect(headings).toEqual([
      { depth: 1, id: "top", text: "Top" },
      { depth: 2, id: "sub", text: "Sub" },
    ]);
  });

  test("accepts a bare fragment and still maps to original offsets", () => {
    const source = `<p>just a fragment</p>`;
    const { html, sourceMap } = ingestHtml(source);
    expect(html).toContain("just a fragment");
    const p = sourceMap.entries.find((e) => e.tag === "p")!;
    expect(source.slice(p.start, p.end)).toBe(source);
  });
});

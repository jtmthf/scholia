import { describe, test, expect } from "vitest";
import { createSearchIndex } from "../../src/search/index.js";
import type { DocRecord } from "../../src/types.js";

function doc(overrides: Partial<DocRecord> & Pick<DocRecord, "urlPath">): DocRecord {
  return {
    fsPath: overrides.urlPath,
    title: "Untitled",
    body: "",
    headings: [],
    ...overrides,
  };
}

const guide = doc({
  urlPath: "/guide.md",
  title: "Guide",
  body: "The quick brown fox jumps. Installation steps live here.",
  headings: [{ depth: 2, id: "installation", text: "Installation" }],
});

const other = doc({
  urlPath: "/other.md",
  title: "Other",
  body: "Completely unrelated xylophone content.",
});

describe("createSearchIndex", () => {
  test("returns nothing for an empty or whitespace query", () => {
    const index = createSearchIndex([guide, other]);
    expect(index.query("")).toEqual([]);
    expect(index.query("   ")).toEqual([]);
  });

  test("finds a document by a word in its body and includes a snippet", () => {
    const index = createSearchIndex([guide, other]);
    const hits = index.query("xylophone");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toBe("/other.md");
    expect(hits[0]?.snippet).toMatch(/xylophone/i);
  });

  test("deep-links a hit to the first matching heading anchor", () => {
    const index = createSearchIndex([guide, other]);
    const hits = index.query("installation");
    expect(hits[0]?.path).toBe("/guide.md#installation");
  });

  test("drops documents that disappear on an incremental update", () => {
    const index = createSearchIndex([guide, other]);
    expect(index.query("xylophone")).toHaveLength(1);

    index.update([guide]);
    expect(index.query("xylophone")).toEqual([]);
    expect(index.query("installation")).toHaveLength(1);
  });

  test("re-indexes a document whose body changed", () => {
    const index = createSearchIndex([guide]);
    expect(index.query("vibraphone")).toEqual([]);

    index.update([{ ...guide, body: "Now mentions a vibraphone instead." }]);
    const hits = index.query("vibraphone");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.snippet).toMatch(/vibraphone/i);
  });
});

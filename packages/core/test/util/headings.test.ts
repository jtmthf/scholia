import { describe, test, expect } from "vitest";
import { extractHeadings } from "../../src/util/headings.js";

describe("extractHeadings", () => {
  test("captures ATX headings with depth and a github-slugger id", () => {
    const headings = extractHeadings("# Title\n\n## Section One\n\ntext");
    expect(headings).toEqual([
      { depth: 1, text: "Title", id: "title" },
      { depth: 2, text: "Section One", id: "section-one" },
    ]);
  });

  test("de-duplicates slugs the way rehype-slug does", () => {
    const headings = extractHeadings("## Setup\n\n## Setup\n\n## Setup");
    expect(headings.map((h) => h.id)).toEqual(["setup", "setup-1", "setup-2"]);
  });

  test("strips inline markdown so the slug matches rendered text", () => {
    const [h] = extractHeadings("## Use `foo` and **bold** text");
    expect(h).toEqual({ depth: 2, text: "Use foo and bold text", id: "use-foo-and-bold-text" });
  });

  test("ignores '#' lines inside fenced code blocks", () => {
    const md = "# Real Heading\n\n```js\n# not a heading\n```\n\n## After Fence";
    expect(extractHeadings(md).map((h) => h.text)).toEqual(["Real Heading", "After Fence"]);
  });

  test("strips trailing closing hashes from ATX headings", () => {
    const [h] = extractHeadings("# Title #");
    expect(h?.text).toBe("Title");
  });
});

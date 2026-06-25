import { describe, test, expect } from "vitest";
import { buildNav, pickEntryPath, type ManifestEntry } from "../../src/nav/manifest.js";
import type { NavNode } from "../../src/types.js";

function md(path: string, title?: string): ManifestEntry {
  return { path, title, kind: "markdown" };
}
function asset(path: string): ManifestEntry {
  return { path, kind: "asset" };
}

describe("buildNav", () => {
  test("builds a nested tree from Page paths, titles from manifest then filename", () => {
    const tree = buildNav([
      md("README.md", "Home"),
      md("guide/intro.md", "Intro"),
      md("guide/advanced-usage.md"),
    ]);
    expect(tree.map((n) => n.title)).toEqual(["Home", "Guide"]);
    const guide = tree.find((n) => n.type === "dir")!;
    // README floats first; the dir follows. Inside, files alphabetical by title.
    expect(guide.children!.map((n) => n.title)).toEqual(["Advanced Usage", "Intro"]);
    // urlPath is the Site-relative Page path (what the viewer routes on).
    const intro = guide.children!.find((n) => n.title === "Intro")!;
    expect(intro.urlPath).toBe("guide/intro.md");
    expect(intro.type).toBe("file");
  });

  test("floats README/index to the top of their directory", () => {
    const tree = buildNav([md("zebra.md"), md("index.md", "Start"), md("apple.md")]);
    expect(tree.map((n) => n.title)).toEqual(["Start", "Apple", "Zebra"]);
  });

  test("excludes Assets (including .html) from the tree", () => {
    const tree = buildNav([md("index.md", "Home"), asset("logo.png"), asset("index.html")]);
    expect(flatten(tree)).toEqual(["Home"]);
  });
});

describe("pickEntryPath", () => {
  test("precedence: index.md > README.md > first top-level .md alphabetically", () => {
    expect(pickEntryPath([md("README.md"), md("index.md"), md("a.md")])).toBe("index.md");
    expect(pickEntryPath([md("README.md"), md("a.md"), md("b.md")])).toBe("README.md");
    expect(pickEntryPath([md("zebra.md"), md("apple.md")])).toBe("apple.md");
  });

  test("ignores index.html (an Asset in M3) and nested index/readme", () => {
    expect(pickEntryPath([asset("index.html"), md("guide/index.md"), md("top.md")])).toBe(
      "top.md",
    );
  });

  test("falls back to the first nested Page when there are no top-level Pages", () => {
    expect(pickEntryPath([md("docs/b.md"), md("docs/a.md")])).toBe("docs/a.md");
  });

  test("returns undefined when the Site has no Markdown Pages", () => {
    expect(pickEntryPath([asset("logo.png")])).toBeUndefined();
  });
});

function flatten(nodes: NavNode[]): string[] {
  return nodes.flatMap((n) => (n.children ? flatten(n.children) : [n.title]));
}

import { describe, test, expect } from "vitest";
import {
  buildNav,
  pickEntryPath,
  compareEntryPaths,
  type ManifestEntry,
} from "../../src/nav/manifest.js";
import type { NavNode } from "../../src/types.js";

function md(path: string, title?: string): ManifestEntry {
  return { path, title, kind: "markdown" };
}
function html(path: string, title?: string): ManifestEntry {
  return { path, title, kind: "html" };
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
    // README floats first; the dir follows. Inside, files ordered by filename.
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

  test("excludes Assets from the tree but includes HTML Pages (M4)", () => {
    const tree = buildNav([md("index.md", "Home"), html("api.html", "API"), asset("logo.png")]);
    expect(flatten(tree).sort()).toEqual(["API", "Home"]);
  });

  test("sets a subtitle on sibling Pages that share an identical title, using their filename", () => {
    const tree = buildNav([
      md("README.md", "Scholia"),
      md("AGENTS.md", "Scholia"),
      md("guide.md", "Guide"),
    ]);
    const byPath = Object.fromEntries(tree.map((n) => [n.urlPath, n.subtitle]));
    expect(byPath["README.md"]).toBe("README.md");
    expect(byPath["AGENTS.md"]).toBe("AGENTS.md");
    expect(byPath["guide.md"]).toBeUndefined();
  });
});

describe("pickEntryPath", () => {
  test("precedence: index.html > index.md > README.md > first top-level Page (M4)", () => {
    expect(pickEntryPath([html("index.html"), md("index.md"), md("README.md")])).toBe("index.html");
    expect(pickEntryPath([md("README.md"), md("index.md"), md("a.md")])).toBe("index.md");
    expect(pickEntryPath([md("README.md"), md("a.md"), md("b.md")])).toBe("README.md");
    expect(pickEntryPath([md("zebra.md"), md("apple.md")])).toBe("apple.md");
  });

  test("an HTML Page can be the first-alphabetically entry", () => {
    expect(pickEntryPath([md("zebra.md"), html("apple.html")])).toBe("apple.html");
  });

  test("a real index.html Page now wins precedence (was an Asset in M3)", () => {
    expect(pickEntryPath([html("index.html"), md("guide/index.md"), md("top.md")])).toBe(
      "index.html",
    );
  });

  test("falls back to the first nested Page when there are no top-level Pages", () => {
    expect(pickEntryPath([md("docs/b.md"), md("docs/a.md")])).toBe("docs/a.md");
  });

  test("returns undefined when the Site has no Pages", () => {
    expect(pickEntryPath([asset("logo.png")])).toBeUndefined();
  });

  test("resolves within an arbitrary directory scope, not just the Site root", () => {
    const entries = [
      md("README.md"),
      md("docs/README.md"),
      md("docs/adr/0001-foo.md"),
      md("docs/adr/0002-bar.md"),
    ];
    // Root scope (default) ignores nested Pages entirely once a root Page exists.
    expect(pickEntryPath(entries)).toBe("README.md");
    // Scoped to "docs": its own README wins over the root's.
    expect(pickEntryPath(entries, "docs")).toBe("docs/README.md");
    // Scoped to "docs/adr": no index/README there, falls back to the first
    // Page directly inside that directory, alphabetically.
    expect(pickEntryPath(entries, "docs/adr")).toBe("docs/adr/0001-foo.md");
  });

  test("numeric-prefixed directories sort by numeric value, not lexicographic (10-guide > 9-intro)", () => {
    // 10-guide would come before 9-intro in pure lexicographic sort
    // ('1' < '9'), but Nav uses numeric-aware collation so 9 < 10.
    const entries = [md("docs/9-intro/index.md"), md("docs/10-guide/index.md")];
    // Both are scoped under docs/ and not top-level. The first in Nav order
    // (numeric-aware) should be 9-intro before 10-guide.
    expect(pickEntryPath(entries, "docs")).toBe("docs/9-intro/index.md");
  });

  test("numeric-prefixed entries at the top level use numeric ordering", () => {
    const entries = [md("10-guide.md"), md("9-intro.md")];
    expect(pickEntryPath(entries)).toBe("9-intro.md");
  });

  test("honours explicit `order` field over filename sort", () => {
    const a = md("b.md", "B");
    a.order = 0;
    const z = md("a.md", "A");
    z.order = 1;
    expect(pickEntryPath([z, a])).toBe("b.md");
  });

  test("entries with no explicit order sort after those with order", () => {
    const noOrder = md("a.md");
    const hasOrder = md("z.md", "Z");
    hasOrder.order = 0;
    expect(pickEntryPath([noOrder, hasOrder])).toBe("z.md");
  });

  test("index.htm is not recognised as an Entry Page", () => {
    expect(pickEntryPath([html("index.htm"), md("a.md")])).toBe("a.md");
  });

  test("scoped fallback uses Nav order across subdirectories", () => {
    // docs/api/ sorts before docs/guide/ alphabetically, so docs/api/overview.md
    // should be the first descendant in depth-first Nav order.
    const entries = [md("docs/guide/intro.md"), md("docs/api/overview.md")];
    expect(pickEntryPath(entries, "docs")).toBe("docs/api/overview.md");
  });
});

describe("compareEntryPaths", () => {
  test("sorts README/index before non-index files", () => {
    expect(compareEntryPaths("README.md", "zebra.md")).toBeLessThan(0);
    expect(compareEntryPaths("index.html", "apple.md")).toBeLessThan(0);
    expect(compareEntryPaths("apple.md", "README.md")).toBeGreaterThan(0);
  });

  test("README.md and index.html are both treated as index files — both sort before non-index", () => {
    // Both are index; the shared function sorts them by filename, then named
    // precedence in pickEntryPath enforces the specific Entry Page order.
    expect(compareEntryPaths("README.md", "apple.md")).toBeLessThan(0);
    expect(compareEntryPaths("index.html", "apple.md")).toBeLessThan(0);
  });

  test("uses numeric-aware collation (10 > 9)", () => {
    expect(compareEntryPaths("9-intro.md", "10-guide.md")).toBeLessThan(0);
    expect(compareEntryPaths("10-guide.md", "9-intro.md")).toBeGreaterThan(0);
  });

  test("honours explicit order over filename", () => {
    // "z.md" with order=0 sorts before "a.md" with order=1
    expect(compareEntryPaths("z.md", "a.md", 0, 1)).toBeLessThan(0);
    expect(compareEntryPaths("a.md", "z.md", 1, 0)).toBeGreaterThan(0);
  });

  test("entries with no order sort after those with order", () => {
    expect(compareEntryPaths("z.md", "a.md", 0, undefined)).toBeLessThan(0);
  });
});

function flatten(nodes: NavNode[]): string[] {
  return nodes.flatMap((n) => (n.children ? flatten(n.children) : [n.title]));
}

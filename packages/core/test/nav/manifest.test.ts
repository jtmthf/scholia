import { describe, test, expect } from "vitest";
import { buildNav, pickEntryPath, type ManifestEntry } from "../../src/nav/manifest.js";
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

  test("excludes Assets from the tree but includes HTML Pages (M4)", () => {
    const tree = buildNav([md("index.md", "Home"), html("api.html", "API"), asset("logo.png")]);
    expect(flatten(tree).sort()).toEqual(["API", "Home"]);
  });

  test("sets a subtitle on sibling Pages that share an identical title, using their filename", () => {
    const tree = buildNav([md("README.md", "Scholia"), md("AGENTS.md", "Scholia"), md("guide.md", "Guide")]);
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
});

function flatten(nodes: NavNode[]): string[] {
  return nodes.flatMap((n) => (n.children ? flatten(n.children) : [n.title]));
}

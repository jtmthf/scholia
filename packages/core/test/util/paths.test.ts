import { describe, test, expect } from "vitest";
import { resolve } from "node:path";
import { isDoc, isMdx, toUrlPath, resolveWithinRoot, classifyFile } from "../../src/util/paths.js";

describe("classifyFile (hosted Page vs Asset, M4)", () => {
  test(".md/.markdown are Markdown Pages", () => {
    expect(classifyFile("guide/intro.md")).toBe("markdown");
    expect(classifyFile("NOTES.MARKDOWN")).toBe("markdown");
  });

  test(".html/.htm are HTML Pages (M4)", () => {
    expect(classifyFile("index.html")).toBe("html");
    expect(classifyFile("guide/page.HTM")).toBe("html");
  });

  test(".mdx and everything else are Assets", () => {
    expect(classifyFile("page.mdx")).toBe("asset");
    expect(classifyFile("img/logo.png")).toBe("asset");
    expect(classifyFile("style.css")).toBe("asset");
  });
});

describe("isDoc / isMdx", () => {
  test("recognizes markdown extensions regardless of case", () => {
    expect(isDoc("guide.md")).toBe(true);
    expect(isDoc("NOTES.MARKDOWN")).toBe(true);
    expect(isDoc("page.MdX")).toBe(true);
    expect(isMdx("page.mdx")).toBe(true);
  });

  test("rejects non-document files", () => {
    expect(isDoc("image.png")).toBe(false);
    expect(isDoc("script.js")).toBe(false);
    expect(isMdx("guide.md")).toBe(false);
  });
});

describe("toUrlPath", () => {
  test("maps a filesystem path to a root-relative URL with forward slashes", () => {
    const root = resolve("/srv/docs");
    expect(toUrlPath(root, resolve("/srv/docs/guide/intro.md"))).toBe("/guide/intro.md");
    expect(toUrlPath(root, resolve("/srv/docs/README.md"))).toBe("/README.md");
  });
});

describe("resolveWithinRoot (directory-traversal guard)", () => {
  const root = resolve("/srv/docs");

  test("resolves a normal request path inside the root", () => {
    expect(resolveWithinRoot(root, "/guide/intro.md")).toBe(resolve("/srv/docs/guide/intro.md"));
  });

  test("treats the bare root path as the root directory", () => {
    expect(resolveWithinRoot(root, "/")).toBe(root);
  });

  test("strips query strings before resolving", () => {
    expect(resolveWithinRoot(root, "/intro.md?foo=bar")).toBe(resolve("/srv/docs/intro.md"));
  });

  test("rejects attempts to escape the root with ..", () => {
    expect(resolveWithinRoot(root, "/../../etc/passwd")).toBeNull();
  });

  test("rejects percent-encoded traversal sequences", () => {
    expect(resolveWithinRoot(root, "/%2e%2e/%2e%2e/etc/passwd")).toBeNull();
  });
});

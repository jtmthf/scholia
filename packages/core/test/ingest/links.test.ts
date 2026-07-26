import { describe, test, expect } from "vitest";
import { rewriteInterPageLinks } from "../../src/ingest/links.js";

const pages = new Set(["index.md", "guide/intro.md", "guide/advanced.md", "about.md"]);

function rewrite(html: string, pagePath: string): string {
  return rewriteInterPageLinks(html, {
    pagePath,
    pagePaths: pages,
    viewerBase: "http://viewer.test",
    slug: "abc",
  });
}

describe("rewriteInterPageLinks", () => {
  test("rewrites a relative link to another Page into a top-nav viewer route", () => {
    const out = rewrite('<a href="about.md">About</a>', "index.md");
    expect(out).toBe(
      '<a href="http://viewer.test/s/abc/about.md" target="_top" rel="noopener">About</a>',
    );
  });

  test("resolves ./ and ../ relative to the current Page's directory", () => {
    expect(rewrite('<a href="./advanced.md">x</a>', "guide/intro.md")).toContain(
      "/s/abc/guide/advanced.md",
    );
    expect(rewrite('<a href="../about.md">x</a>', "guide/intro.md")).toContain("/s/abc/about.md");
    expect(rewrite('<a href="intro.md">x</a>', "guide/advanced.md")).toContain(
      "/s/abc/guide/intro.md",
    );
  });

  test("drops a query/hash when matching but the route points at the Page", () => {
    expect(rewrite('<a href="about.md#section">x</a>', "index.md")).toContain("/s/abc/about.md");
  });

  test("leaves Asset, external, absolute, and in-page links untouched", () => {
    for (const href of [
      "./logo.png",
      "https://example.com",
      "mailto:a@b.com",
      "/root",
      "#heading",
    ]) {
      const html = `<a href="${href}">x</a>`;
      expect(rewrite(html, "index.md")).toBe(html);
    }
  });

  test("leaves a relative link to a non-existent Page untouched", () => {
    const html = '<a href="missing.md">x</a>';
    expect(rewrite(html, "index.md")).toBe(html);
  });

  test("preserves existing attributes on the anchor", () => {
    const out = rewrite('<a class="x" href="about.md" data-y="1">About</a>', "index.md");
    expect(out).toContain('class="x"');
    expect(out).toContain('data-y="1"');
    expect(out).toContain('target="_top"');
  });
});

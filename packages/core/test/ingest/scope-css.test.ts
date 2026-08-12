import { describe, test, expect } from "vitest";
import { scopeToArticle } from "../../src/ingest/scope-css.js";

describe("scopeToArticle (issue #105)", () => {
  test("wraps rules in @scope (article) so they stop at the Page's own content", () => {
    const out = scopeToArticle("p { color: red }");
    expect(out).toContain("@scope (article)");
    expect(out).toContain("p {");
  });

  test("retargets body onto the article itself, rather than vanishing", () => {
    const out = scopeToArticle("body { font-family: system-ui; max-width: 40rem }");
    expect(out).toContain(":scope {");
    expect(out).not.toMatch(/(?<!:scope\s*)\bbody\b\s*\{/);
  });

  test("retargets html the same way", () => {
    const out = scopeToArticle("html { box-sizing: border-box }");
    expect(out).toContain(":scope {");
  });

  test("retargets :root, so custom properties the Page relies on still land", () => {
    const out = scopeToArticle(":root { --brand: hotpink }");
    expect(out).toContain(":scope {");
    expect(out).not.toContain(":root");
  });

  test("retargets a compound selector's tag component, keeping its class/id", () => {
    const out = scopeToArticle("body.dark p { color: red }");
    expect(out).toContain(":scope.dark p {");
  });

  test("leaves ordinary selectors alone beyond scoping them", () => {
    const out = scopeToArticle("* { box-sizing: border-box } h1 { font-size: 2rem }");
    expect(out).toContain("* {");
    expect(out).toContain("h1 {");
  });

  test("recurses into @media, scoping the rules nested inside it", () => {
    const out = scopeToArticle("@media (min-width: 600px) { body { max-width: 60rem } }");
    expect(out).toContain("@scope (article)");
    expect(out).toContain("@media (min-width: 600px)");
    expect(out).toContain(":scope {");
  });

  test("leaves @keyframes selectors (percentages, from/to) untouched", () => {
    const css =
      "@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }";
    const out = scopeToArticle(css);
    expect(out).toContain("from {");
    expect(out).toContain("to {");
    expect(out).not.toContain(":scope");
  });

  test("keeps @import outside the @scope block — it's only valid at the stylesheet's top", () => {
    const out = scopeToArticle('@import url("foo.css");\nbody { color: red }');
    const importIndex = out.indexOf("@import");
    const scopeIndex = out.indexOf("@scope");
    expect(importIndex).toBeGreaterThanOrEqual(0);
    expect(scopeIndex).toBeGreaterThan(importIndex);
  });

  test("fails closed on malformed CSS instead of emitting unscoped rules", () => {
    expect(scopeToArticle("body { max-width: 40rem")).toBe("");
  });

  test("returns an empty string for empty input", () => {
    expect(scopeToArticle("")).toBe("");
  });
});

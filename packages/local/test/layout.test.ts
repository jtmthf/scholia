import { expect, test } from "vitest";
import type { Heading, NavNode } from "@scholia/core";
import { renderPage, type LayoutOptions } from "../src/render/layout.js";
import { canonicalHtml } from "./helpers/canonical-html.js";

// The chrome is furniture, not content: it changes only when someone means to
// change it. These goldens are the mechanical proof of that — the canonical DOM
// of a fully-populated page and of the shapes that turn parts of it off. A
// re-templating that keeps the rendered document identical leaves them
// untouched; anything that moves an element, an attribute or a class shows up
// as a reviewable diff instead of "looks the same to me".
//
// They were captured from the string-template `layout.ts` this file's subject
// replaced (issue #25), *before* the Preact SSR rewrite, and survived it byte
// for byte. To re-verify that claim: restore `layout.ts` from 6a158fc over
// `layout.tsx` and run this file — the goldens still pass.

function navNode(partial: Partial<NavNode> & Pick<NavNode, "type" | "title" | "urlPath">): NavNode {
  return { fsPath: `/tmp${partial.urlPath}`, order: 0, ...partial };
}

// Deliberately hostile strings: every field the chrome interpolates carries at
// least one character that has to survive escaping — including `'` and `>`,
// which the two templating mechanisms encode differently but render the same.
const NASTY = `Guide & "Notes" <intro> — it's > that`;

const NAV: NavNode[] = [
  navNode({ type: "file", title: "Home", urlPath: "/README.md" }),
  navNode({
    type: "dir",
    title: "Guide & Reference",
    urlPath: "/guide",
    children: [
      navNode({ type: "file", title: "Intro", urlPath: "/guide/intro.md", subtitle: "guide/" }),
      navNode({ type: "file", title: NASTY, urlPath: "/guide/advanced.md" }),
      navNode({
        type: "dir",
        title: "Deep",
        urlPath: "/guide/deep",
        subtitle: "nested",
        children: [navNode({ type: "file", title: "Deeper", urlPath: "/guide/deep/deeper.md" })],
      }),
    ],
  }),
  // A directory with no children at all: Nav must not emit an empty <ul>.
  navNode({ type: "dir", title: "Empty", urlPath: "/empty" }),
];

const HEADINGS: Heading[] = [
  { depth: 1, id: "title", text: "Title" },
  { depth: 2, id: "section-one", text: "Section & One" },
  { depth: 3, id: "sub-a", text: "Sub 'A'" },
  { depth: 2, id: "section-two", text: "Section <Two>" },
  // Outside the 2..3 window the Outline shows — must be filtered out.
  { depth: 4, id: "too-deep", text: "Too Deep" },
];

const CONTENT_HTML =
  `<h1 id="title">Title</h1>\n<p>Body &amp; text with an <a href="/guide/intro.md">inter-Page link</a>.</p>\n` +
  `<pre class="shiki"><code>  indented\n    deeper\n</code></pre>\n`;

const SOURCE_MARKDOWN = `# Title\n\nA fence that closes a script tag: </script> and a comment: <!-- hi -->\n`;

const FULL: LayoutOptions = {
  title: NASTY,
  contentHtml: CONTENT_HTML,
  headings: HEADINGS,
  nav: NAV,
  currentPath: "/guide/deep/deeper.md",
  showNav: true,
  rootName: "my & docs",
  editorAvailable: true,
  filePath: "/Users/someone/my & docs/guide/deep/deeper.md",
  sourceMarkdown: SOURCE_MARKDOWN,
  colophon: {
    relPath: "guide/deep/deeper.md",
    mtimeMs: Date.UTC(2026, 6, 28, 11, 32, 7, 250),
    provenance: { branch: "feat/it's-fine", sha: "0123456789abcdef", dirty: true },
  },
};

// Single-file mode with no editor resolved: no Nav pane, no menu toggle, no
// Outline, no Colophon, and "Copy path" standing in for "Open in editor".
const MINIMAL: LayoutOptions = {
  title: "Solo",
  contentHtml: "<h1>Solo</h1>",
  headings: [],
  nav: [],
  currentPath: "/solo.md",
  showNav: false,
  rootName: "solo",
  editorAvailable: false,
  filePath: "/Users/someone/solo.md",
  sourceMarkdown: "# Solo\n",
  colophon: null,
};

// The Site root: an empty breadcrumb, and a Colophon with no git Provenance to
// report (not every served directory is a repo).
const ROOT_NO_PROVENANCE: LayoutOptions = {
  ...FULL,
  currentPath: "/",
  colophon: { relPath: "", mtimeMs: Date.UTC(2026, 0, 1), provenance: {} },
};

test("the full chrome renders the pinned document", async () => {
  await expect(canonicalHtml(renderPage(FULL))).toMatchFileSnapshot(
    "./__snapshots__/chrome-full.txt",
  );
});

test("single-file mode without an editor renders the pinned document", async () => {
  await expect(canonicalHtml(renderPage(MINIMAL))).toMatchFileSnapshot(
    "./__snapshots__/chrome-minimal.txt",
  );
});

test("the Site root without Provenance renders the pinned document", async () => {
  await expect(canonicalHtml(renderPage(ROOT_NO_PROVENANCE))).toMatchFileSnapshot(
    "./__snapshots__/chrome-root.txt",
  );
});

// The goldens collapse whitespace, so they can't speak for `<pre>`. Content HTML
// is already rendered by the shared pipeline and must reach the page byte for
// byte — not re-escaped, not reindented, not parsed and re-serialized.
test("content HTML is passed through verbatim, whitespace included", () => {
  expect(renderPage(FULL)).toContain(CONTENT_HTML);
});

// "Copy markdown" reads this back with JSON.parse, so the bytes have to be
// exactly the JSON encoding — with `<` escaped, so neither the "</script>" nor
// the "<!--" in the source can end the script element early.
test("the embedded source is JSON with every `<` escaped", () => {
  const html = renderPage(FULL);
  const embedded = html.match(
    /<script type="application\/json" id="scholia-source-md">([\s\S]*?)<\/script>/,
  );
  expect(embedded?.[1]).toBe(JSON.stringify(SOURCE_MARKDOWN).replace(/</g, "\\u003c"));
  expect(embedded?.[1]).not.toContain("</script>");
  expect(JSON.parse(embedded![1]!)).toBe(SOURCE_MARKDOWN);
});

// The pre-paint theme script has to reach the browser as executable JS: escaped
// as text it would silently stop applying the saved theme, and the page would
// flash the wrong color scheme on every load.
test("the pre-paint theme script is emitted unescaped", () => {
  const html = renderPage(FULL);
  expect(html).toContain("localStorage.getItem('scholia-theme')");
  expect(html).not.toContain("localStorage.getItem(&#39;scholia-theme&#39;)");
});

test("the document opens with a doctype", () => {
  expect(renderPage(FULL).startsWith("<!doctype html>")).toBe(true);
});

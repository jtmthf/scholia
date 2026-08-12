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
// for byte. Issue #28 is the first change that moved them on purpose: the comment
// rail is server-rendered chrome now (ADR-0018, ADR-0030), so it is in the
// goldens, and the article carries the Page path and content hash a Comment binds
// to. Everything above the article is unchanged from that original capture.

function navNode(partial: Partial<NavNode> & Pick<NavNode, "type" | "title" | "urlPath">): NavNode {
  return { fsPath: `/tmp${partial.urlPath}`, order: 0, ...partial };
}

// A Comment's timestamp is rendered with `toLocaleString`, so its text depends on
// the machine's timezone — a golden containing it would say "Jul 28, 7:32 AM" here
// and "11:32 AM" in CI. The redaction keeps the element in the golden (its
// presence and position are chrome) without pinning what a clock says.
function pinnedDocument(html: string): string {
  return canonicalHtml(html).replace(
    /(comment-timestamp"\n\s*)"[^"]*"/g,
    '$1"<local time, redacted>"',
  );
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

// The comment rail is chrome too (ADR-0018, ADR-0030) — server-rendered like the
// Nav and the Outline, so it is in the golden. One anchored Conversation and one
// Page-level, which is what puts both rail sections on the page; the third is
// resolved, so the golden pins what a collapsed card looks like. Between them
// they carry every folded state a Comment can be in (ADR-0032): edited, reacted
// to, and a tombstone.
const COMMENTS: NonNullable<LayoutOptions["comments"]> = {
  pagePath: "guide/deep/deeper.md",
  contentHash: "0".repeat(64),
  displayName: "Reviewer & Co",
  canModerate: true,
  conversations: [
    {
      id: "01920000-0000-7000-8000-000000000001",
      pagePath: "guide/deep/deeper.md",
      anchor: { textQuote: { exact: "Body & text", prefix: "Title\n", suffix: " with an" } },
      anchorStatus: "live",
      resolved: false,
      resolvedBy: null,
      visibility: "public",
      comments: [
        {
          id: "01920000-0000-7000-8000-000000000002",
          author: { name: "Reviewer & Co", kind: "human", tier: "viewer", source: "native" },
          body: "Does this still hold? <not markup>",
          createdAt: "2026-07-28T11:32:07.250Z",
          editedAt: "2026-07-28T11:40:00.000Z",
          deleted: false,
          mine: true,
          reactions: [
            { emoji: "👍", count: 2, mine: true, authors: ["Reviewer & Co", "Someone Else"] },
            { emoji: "👀", count: 1, mine: false, authors: ["Someone Else"] },
          ],
        },
        {
          id: "01920000-0000-7000-8000-000000000005",
          author: { name: "Someone Else", kind: "human", tier: "viewer", source: "native" },
          body: "",
          createdAt: "2026-07-28T11:45:00.000Z",
          editedAt: null,
          deleted: true,
          mine: false,
          reactions: [],
        },
      ],
    },
    {
      id: "01920000-0000-7000-8000-000000000003",
      pagePath: "guide/deep/deeper.md",
      anchor: null,
      anchorStatus: "live",
      resolved: false,
      resolvedBy: null,
      visibility: "public",
      comments: [
        {
          id: "01920000-0000-7000-8000-000000000004",
          author: { name: "Someone Else", kind: "human", tier: "viewer", source: "native" },
          body: "Whole-page note.",
          createdAt: "2026-07-28T12:00:00.000Z",
          editedAt: null,
          deleted: false,
          mine: false,
          reactions: [],
        },
      ],
    },
    {
      id: "01920000-0000-7000-8000-000000000006",
      pagePath: "guide/deep/deeper.md",
      anchor: null,
      anchorStatus: "live",
      resolved: true,
      resolvedBy: "Someone Else",
      visibility: "public",
      comments: [
        {
          id: "01920000-0000-7000-8000-000000000007",
          author: { name: "Reviewer & Co", kind: "human", tier: "viewer", source: "native" },
          body: "Settled — this is fixed.",
          createdAt: "2026-07-28T12:10:00.000Z",
          editedAt: null,
          deleted: false,
          mine: true,
          reactions: [{ emoji: "✅", count: 1, mine: false, authors: ["Someone Else"] }],
        },
      ],
    },
  ],
};

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
  pageStyles: "",
  comments: COMMENTS,
  colophon: {
    relPath: "guide/deep/deeper.md",
    mtimeMs: Date.UTC(2026, 6, 28, 11, 32, 7, 250),
    provenance: { branch: "feat/it's-fine", sha: "0123456789abcdef", dirty: true },
  },
};

// Single-file mode with no editor resolved: no Nav pane, no menu toggle, no
// Outline, no Colophon, and "Copy path" standing in for "Open in editor". Also
// the render-error shape — `comments: null` means there is no Page to comment
// on, so the rail is absent rather than empty.
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
  pageStyles: "",
  comments: null,
  colophon: null,
};

// An HTML Page: its own markup as the content, its own stylesheets hoisted into
// the head, and an empty rail because nobody has said anything about it yet.
const HTML_PAGE: LayoutOptions = {
  ...MINIMAL,
  title: "HTML Home",
  currentPath: "/index.html",
  contentHtml: `<h1 data-sm="3">HTML Home</h1>\n<p data-sm="4">Hand-written &amp; interactive.</p>`,
  sourceMarkdown: "<!doctype html>\n<html></html>\n",
  pageStyles: `<style>body { --page-owns-this: 1; }</style>\n<link rel="stylesheet" href="./page.css">`,
  comments: {
    pagePath: "index.html",
    contentHash: "f".repeat(64),
    displayName: "Reviewer & Co",
    canModerate: false,
    conversations: [],
  },
};

// The Site root: an empty breadcrumb, and a Colophon with no git Provenance to
// report (not every served directory is a repo).
const ROOT_NO_PROVENANCE: LayoutOptions = {
  ...FULL,
  currentPath: "/",
  colophon: { relPath: "", mtimeMs: Date.UTC(2026, 0, 1), provenance: {} },
};

test("the full chrome renders the pinned document", async () => {
  await expect(pinnedDocument(renderPage(FULL))).toMatchFileSnapshot(
    "./__snapshots__/chrome-full.txt",
  );
});

test("single-file mode without an editor renders the pinned document", async () => {
  await expect(pinnedDocument(renderPage(MINIMAL))).toMatchFileSnapshot(
    "./__snapshots__/chrome-minimal.txt",
  );
});

test("the Site root without Provenance renders the pinned document", async () => {
  await expect(pinnedDocument(renderPage(ROOT_NO_PROVENANCE))).toMatchFileSnapshot(
    "./__snapshots__/chrome-root.txt",
  );
});

test("an HTML Page renders the pinned document, with its own styles hoisted", async () => {
  await expect(pinnedDocument(renderPage(HTML_PAGE))).toMatchFileSnapshot(
    "./__snapshots__/chrome-html-page.txt",
  );
});

// The rail is server-rendered, not fetched — a reader with JavaScript off still
// sees every Conversation on the Page (ADR-0011).
test("Conversations are in the first response, not left to the client", () => {
  const html = renderPage(FULL);
  expect(html).toContain("Does this still hold?");
  expect(html).toContain("Whole-page note.");
  expect(html).toContain("“Body &amp; text”");
});

// The Comment's binding is taken from the render (CONTEXT "Comment"), so the
// hash the client posts back has to be the one on the page it is looking at.
test("the article carries the Page path and the content hash it was rendered from", () => {
  const html = renderPage(FULL);
  expect(html).toContain(`data-page-path="guide/deep/deeper.md"`);
  expect(html).toContain(`data-content-hash="${"0".repeat(64)}"`);
});

test("a page with nothing to comment on renders no rail and no comment data", () => {
  const html = renderPage(MINIMAL);
  expect(html).not.toContain(`id="scholia-comments"`);
  expect(html).not.toContain(`id="scholia-comments-data"`);
  expect(html).not.toContain("has-comments");
});

// The client hydrates the rail from this rather than fetching it back, so it has
// to be the same values the server just rendered from — and JSON-escaped, so a
// comment body can't end the script element early.
test("the comment layer's props are embedded as escaped JSON", () => {
  const html = renderPage(FULL);
  const embedded = html.match(
    /<script type="application\/json" id="scholia-comments-data">([\s\S]*?)<\/script>/,
  );
  expect(embedded?.[1]).not.toContain("</script>");
  expect(JSON.parse(embedded![1]!)).toEqual(COMMENTS);
});

// An HTML Page brings its own styling and there is no frame to contain it, so it
// lands in the head — after the chrome's, which is what lets the Page win.
test("an HTML Page's stylesheets are hoisted into the head, after the chrome's", () => {
  const html = renderPage(HTML_PAGE);
  const head = html.slice(0, html.indexOf("</head>"));
  expect(head).toContain(`<link rel="stylesheet" href="./page.css">`);
  expect(head.indexOf("/__assets/client.css")).toBeLessThan(head.indexOf("./page.css"));
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

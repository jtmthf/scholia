import { expect } from "vitest";
import { test } from "../helpers/tmp.js";
import { scanTree } from "../../src/nav/tree.js";
import type { NavNode } from "../../src/types.js";

function titles(nodes: NavNode[]): string[] {
  return nodes.map((n) => n.title);
}

test("floats README to the top, then orders files by frontmatter `order`", async ({ tmp }) => {
  await tmp.write("README.md", "# Home\n");
  await tmp.write("apple.md", "---\norder: 2\n---\n# Apple\n");
  await tmp.write("zebra.md", "---\norder: 1\n---\n# Zebra\n");

  const { tree } = await scanTree(tmp.root);
  // Titles come from each document's first h1, not the (humanized) filename;
  // README floats first as the index, then files follow their frontmatter
  // `order` — sort key is filename, unaffected by the h1-derived label.
  expect(titles(tree)).toEqual(["Home", "Zebra", "Apple"]);
});

test("derives titles from frontmatter or a humanized filename, and builds URL paths", async ({
  tmp,
}) => {
  await tmp.write("getting-started.md", "# Getting Started\n");
  await tmp.write("custom.md", "---\ntitle: A Custom Title\n---\nbody\n");

  const { tree } = await scanTree(tmp.root);
  const byPath = Object.fromEntries(tree.map((n) => [n.urlPath, n.title]));
  expect(byPath["/getting-started.md"]).toBe("Getting Started");
  expect(byPath["/custom.md"]).toBe("A Custom Title");
});

test("a _meta.json object sets child order and overrides titles", async ({ tmp }) => {
  await tmp.write("README.md", "# Home\n");
  await tmp.write(
    "guide/_meta.json",
    JSON.stringify({ "advanced.mdx": "Advanced Guide", "getting-started.md": "Getting Started" }),
  );
  await tmp.write(
    "guide/getting-started.md",
    "---\ntitle: Ignored Frontmatter Title\n---\n# Start\n",
  );
  await tmp.write("guide/advanced.mdx", "# Advanced\n");

  const { tree } = await scanTree(tmp.root);
  const guide = tree.find((n) => n.type === "dir");
  expect(guide?.title).toBe("Guide");
  // Order follows the keys of _meta.json; titles come from _meta, not frontmatter.
  expect(titles(guide?.children ?? [])).toEqual(["Advanced Guide", "Getting Started"]);
});

test("skips dotfiles and directories that contain no documents", async ({ tmp }) => {
  await tmp.write("README.md", "# Home\n");
  await tmp.write(".secret.md", "# Hidden\n");
  await tmp.write("assets/logo.txt", "not a document");

  const { tree, docs } = await scanTree(tmp.root);
  expect(titles(tree)).toEqual(["Home"]);
  expect(docs.map((d) => d.urlPath)).toEqual(["/README.md"]);
});

test("collects DocRecords with extracted headings", async ({ tmp }) => {
  await tmp.write("README.md", "# Home\n\n## Details\n\ntext\n");

  const { docs } = await scanTree(tmp.root);
  const home = docs.find((d) => d.urlPath === "/README.md");
  expect(home?.title).toBe("Home");
  expect(home?.headings.map((h) => h.text)).toEqual(["Home", "Details"]);
});

test("sorts numbered files by filename, not by their prose h1 label (ADR-style numbering)", async ({
  tmp,
}) => {
  // Each h1 is alphabetically out of order with its numeric filename prefix —
  // exactly the docs/adr/ shape the numeric-filename sort key protects
  // against. Sorting by label would scramble these; sorting by basename must
  // not, even once labels come from prose h1 text instead of the filename.
  await tmp.write("0001-unguessable-url.md", "# Unguessable URL Is The Access Gate\n");
  await tmp.write("0002-anchor-resolution.md", "# Anchor Resolution Strategy\n");
  await tmp.write("0010-mirror-comments.md", "# Mirror Comments To GitHub\n");

  const { tree } = await scanTree(tmp.root);
  expect(titles(tree)).toEqual([
    "Unguessable URL Is The Access Gate",
    "Anchor Resolution Strategy",
    "Mirror Comments To GitHub",
  ]);
});

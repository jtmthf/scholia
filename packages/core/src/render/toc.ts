import { visit } from "unist-util-visit";
import { toText } from "../util/text.js";
import type { Heading } from "../types.js";

// Rehype plugin: collect h1-h3 headings (with their slug ids) into the supplied
// array for table-of-contents rendering. Run AFTER rehype-slug and BEFORE
// rehype-autolink-headings so the text is clean and ids are present.
export function rehypeCollectToc(headings: Heading[]) {
  return (tree: any) => {
    visit(tree, "element", (node: any) => {
      const match = /^h([1-6])$/.exec(node.tagName ?? "");
      if (!match) return;
      const depth = Number(match[1]);
      if (depth > 3) return;
      const id = node.properties?.id;
      if (!id) return;
      headings.push({ depth, id: String(id), text: toText(node).trim() });
    });
  };
}

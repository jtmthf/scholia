// Extract the prose a Markdown Page produces, without the syntax that produces
// it — the counterpart to `renderedText` for the other Page kind (CONTEXT
// "Page").
//
// Search indexes and snippets are the reason this exists (issue #116). A
// snippet cut out of raw source shows the reader `# Anchor` and
// `[ADR-0002](./0002-…)` — syntax, not the words the syntax stands for — and a
// query for a phrase that straddles a marker (`quick **brown** fox`) never
// matches at all. An HTML Page already goes through `renderedText` for exactly
// this; a Markdown Page goes through here.
//
// This is a *derived* text, like `htmlToDerivedText`: offsets in it do not line
// up with the source, so it must never be used to build a Source range or
// resolve an Anchor (ADR-0002 anchors against rendered text — ADR-0029).
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Nodes as MdastNodes } from "mdast";
import { htmlToDerivedText } from "../util/text.js";

// Parsing alone — no transformers, no highlighter, nothing async. `use` still
// matters: remark-gfm registers the micromark extensions that make tables,
// strikethrough and autolinks parse as themselves rather than as paragraph text.
const parser = unified().use(remarkParse).use(remarkGfm).freeze();

// Nodes whose text stands on its own line in the rendered Page, so the derived
// text gets a blank line after them rather than running two of them together.
const ENDS_A_BLOCK = new Set([
  "paragraph",
  "heading",
  "code",
  "blockquote",
  "listItem",
  "tableCell",
  "thematicBreak",
  "definition",
  "footnoteDefinition",
]);

// Containers whose children are blocks. Markdown has one `html` node type for
// both a raw block and a raw inline span, and only the parent tells them apart:
// `<div>…</div>` at the top level ends a block, `<kbd>k</kbd>` mid-sentence must
// not break the sentence around it. Nothing else needs to ask, which is why the
// parent's kind is passed down rather than the node carrying it.
const HOLDS_BLOCKS = new Set(["root", "blockquote", "listItem", "list", "footnoteDefinition"]);

function collect(node: MdastNodes, out: string[], parentHoldsBlocks: boolean): void {
  switch (node.type) {
    // `text` is the prose itself; `inlineCode` and `code` are text the reader
    // sees too — dropping them would take a search for a symbol name with them.
    case "text":
    case "inlineCode":
    case "code":
      out.push(node.value);
      break;
    // Raw HTML inside Markdown is still a Page's visible text once served.
    case "html":
      // `htmlToDerivedText`, not `renderedText`: the latter is the uncollapsed
      // text-quote surface anchor migration matches against (ADR-0029) and puts
      // no break between block elements, so a raw `<ul>` would run its items
      // together into one word. This is derived text and takes the derived-text
      // extractor.
      out.push(htmlToDerivedText(node.value));
      if (parentHoldsBlocks) out.push("\n\n");
      break;
    // An image's alt text is what a reader who cannot see it is given.
    case "image":
      if (node.alt) out.push(node.alt);
      break;
    case "imageReference":
      if (node.alt) out.push(node.alt);
      break;
    // A hard break reads as a line ending, not as a word boundary.
    case "break":
      out.push("\n");
      break;
    default:
      if ("children" in node) {
        const childrenAreBlocks = HOLDS_BLOCKS.has(node.type);
        for (const child of node.children) collect(child, out, childrenAreBlocks);
      }
      break;
  }
  if (ENDS_A_BLOCK.has(node.type)) out.push("\n\n");
}

/** The visible prose of a Markdown source, with its syntax removed. */
export function markdownText(source: string): string {
  if (!source.trim()) return "";
  const out: string[] = [];
  collect(parser.parse(source), out, true);
  return out
    .join("")
    .replace(/[^\S\n]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

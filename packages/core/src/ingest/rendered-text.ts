// Extract the plain visible text of a rendered/served HTML fragment — the string
// representation cross-Version anchor migration matches against (M6).
//
// An Anchor's text-quote is captured in the content iframe from `body.textContent`
// (see @collab/bridge iframe entry, `buildUniqueQuote`). To re-resolve that quote
// against a NEW Version server-side we need the same text the browser would see,
// derived from the Version's stored rendered fragment (`renderedHash`). The stored
// fragment is clean — the bridge script is injected only at serve time, so no
// script/style text pollutes it — but we still skip <script>/<style> text defensively
// so this works on either a fragment or a full served HTML document.
//
// This mirrors DOM `textContent`: text nodes concatenated in document order with no
// whitespace collapsing (the iframe's `body.textContent` is likewise un-collapsed),
// so offsets/context line up with `searchQuote`'s literal matching (ADR-0002).
import { parseFragment, defaultTreeAdapter } from "parse5";

interface P5Node {
  nodeName: string;
  tagName?: string;
  value?: string;
  childNodes?: P5Node[];
}

const SKIP_TEXT_TAGS = new Set(["script", "style", "template"]);

// The named entities parse5 leaves us are already decoded in text nodes, so we
// only concatenate #text values.
function collectText(node: P5Node, out: string[]): void {
  if (node.nodeName === "#text") {
    if (node.value) out.push(node.value);
    return;
  }
  if (node.tagName && SKIP_TEXT_TAGS.has(node.tagName)) return;
  for (const child of node.childNodes ?? []) collectText(child, out);
}

// Plain visible text of an HTML fragment or document, matching browser
// `textContent` semantics closely enough for text-quote migration.
export function renderedText(html: string): string {
  const doc = parseFragment(html, { treeAdapter: defaultTreeAdapter }) as unknown as P5Node;
  const out: string[] = [];
  collectText(doc, out);
  return out.join("");
}

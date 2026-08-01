import { parseFragment, defaultTreeAdapter } from "parse5";
import type { Nodes } from "hast";

// Recursively extract the text content of a hast node. Takes the loose shape
// rather than `Nodes` itself because plugins hand it subtrees mid-rewrite, when
// a node may not yet satisfy the full type.
type TextLike = { type?: string; value?: string; children?: TextLike[] };

export function toText(node: Nodes | TextLike | null | undefined): string {
  if (!node) return "";
  const n = node as TextLike;
  if (n.type === "text") return n.value ?? "";
  if (Array.isArray(n.children)) {
    return n.children.map(toText).join("");
  }
  return "";
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// "getting-started" -> "Getting Started"
export function humanize(name: string): string {
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---- HTML-to-derived-text conversion ----------------------------------------

// parse5 node shape after parsing a fragment.
interface P5Node {
  nodeName: string;
  tagName?: string;
  value?: string;
  childNodes?: P5Node[];
  attrs?: Array<{ name: string; value: string }>;
}

// HTML elements that should introduce a line break before/after in derived text.
// A `br` adds a single newline; most block elements add a trailing newline.
const SKIP_TAGS = new Set(["script", "style", "template", "head", "noscript"]);

function isVoidBr(tagName: string): boolean {
  return tagName === "br" || tagName === "hr";
}

function isBlock(tagName: string): boolean {
  return (
    tagName === "p" ||
    tagName === "div" ||
    tagName === "section" ||
    tagName === "article" ||
    tagName === "header" ||
    tagName === "footer" ||
    tagName === "nav" ||
    tagName === "main" ||
    tagName === "aside" ||
    tagName === "blockquote" ||
    tagName === "pre" ||
    tagName === "ul" ||
    tagName === "ol" ||
    tagName === "li" ||
    tagName === "table" ||
    tagName === "tr" ||
    tagName === "form" ||
    tagName === "fieldset" ||
    tagName === "figure" ||
    tagName === "figcaption" ||
    tagName === "details" ||
    tagName === "h1" ||
    tagName === "h2" ||
    tagName === "h3" ||
    tagName === "h4" ||
    tagName === "h5" ||
    tagName === "h6"
  );
}

function collectDerivedText(node: P5Node, out: string[]): void {
  if (node.nodeName === "#text") {
    if (node.value) out.push(node.value);
    return;
  }
  const tag = node.tagName;
  if (tag && SKIP_TAGS.has(tag)) return;

  // Recurse into children.
  for (const child of node.childNodes ?? []) collectDerivedText(child, out);

  // Append line break after block / br / hr.
  if (tag && (isBlock(tag) || isVoidBr(tag))) {
    // Avoid trailing newline if the last thing pushed is already one.
    if (out.length > 0 && out[out.length - 1] !== "\n") out.push("\n");
  }
}

/**
 * Produce a best-effort derived plain-text representation of an HTML document.
 *
 * The output is a convenience for agents that send `Accept: text/markdown`
 * against an HTML Page (Issue #64). It is NOT the Page's Source — line numbers
 * are fabricated and the result must not be used to construct source ranges.
 */
export function htmlToDerivedText(html: string): string {
  if (!html) return "";
  const doc = parseFragment(html, {
    treeAdapter: defaultTreeAdapter,
  }) as unknown as P5Node;
  const out: string[] = [];
  collectDerivedText(doc, out);
  const text = out.join("");
  // Collapse runs of 3+ newlines to at most two, and trim leading/trailing blank lines.
  return text
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

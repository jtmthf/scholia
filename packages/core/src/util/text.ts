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

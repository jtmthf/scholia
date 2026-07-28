import { basename } from "node:path";
import type { NavNode } from "../types.js";

// Sibling Pages sometimes share an identical title (e.g. several docs each
// opening with the same generic H1) — Nav otherwise has no way to tell them
// apart. Give every node in a colliding group a subtitle of its own filename
// and recurse into children, since each directory's sibling set is independent.
export function disambiguateSiblings(nodes: NavNode[]): void {
  const counts = new Map<string, number>();
  for (const node of nodes) counts.set(node.title, (counts.get(node.title) ?? 0) + 1);

  for (const node of nodes) {
    if ((counts.get(node.title) ?? 0) > 1) node.subtitle = basename(node.fsPath);
    if (node.children) disambiguateSiblings(node.children);
  }
}

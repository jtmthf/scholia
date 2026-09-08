import type { NavNode } from "../types.js";

export type NavPage = NavNode & { type: "file"; children?: never };

/**
 * Return Pages in the Nav's reading sequence: depth-first through the Nav
 * tree, omitting directory labels themselves. Consumers that move between
 * Pages must use this rather than inventing a second ordering.
 */
export function flattenNav(nodes: NavNode[]): NavPage[] {
  const pages: NavPage[] = [];
  for (const node of nodes) {
    if (node.type === "file") pages.push(node as NavPage);
    else pages.push(...flattenNav(node.children ?? []));
  }
  return pages;
}

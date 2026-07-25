import { basename } from "node:path";
import { humanize } from "../util/text.js";
import type { NavNode } from "../types.js";

// A flat manifest entry as the server holds it (path + title + kind), the input
// to hosted Nav and Entry Page precedence. Pure: unlike `scanTree`, this never
// touches the filesystem — it derives the tree purely from stored Page paths
// (PLAN §5 M3, CONTEXT "Nav" / "Entry Page").
export interface ManifestEntry {
  /** Site-relative POSIX path, e.g. "guide/intro.md". */
  path: string;
  title?: string | null;
  kind: "markdown" | "html" | "asset";
}

const INDEX_RE = /^(readme|index)\.(md|markdown|html?)$/i;

function stripExt(name: string): string {
  return name.replace(/\.(md|markdown|html?)$/i, "");
}

// A Page (Markdown or HTML) appears in Nav and is entry-eligible; Assets do not.
function isPage(kind: ManifestEntry["kind"]): boolean {
  return kind === "markdown" || kind === "html";
}

// Build the auto-generated Nav tree from a Version's manifest. Only Markdown
// Pages appear (Assets — incl. `.html` in M3 — are served but never listed,
// CONTEXT "Asset"). Folder structure becomes a collapsible tree; each Page is
// labeled by its title (first `<h1>`/frontmatter) falling back to a humanized
// filename. README/index float to the top of their directory; otherwise
// alphabetical by title (no frontmatter order is available from the manifest).
export function buildNav(entries: ManifestEntry[]): NavNode[] {
  const root: NavNode[] = [];
  // dir POSIX path ("" = root) -> the children array to push into.
  const dirChildren = new Map<string, NavNode[]>([["", root]]);

  function ensureDir(dirPath: string): NavNode[] {
    const existing = dirChildren.get(dirPath);
    if (existing) return existing;

    const slash = dirPath.lastIndexOf("/");
    const name = slash === -1 ? dirPath : dirPath.slice(slash + 1);
    const parentPath = slash === -1 ? "" : dirPath.slice(0, slash);
    const parentChildren = ensureDir(parentPath);

    const node: NavNode = {
      type: "dir",
      title: humanize(name),
      urlPath: dirPath,
      fsPath: dirPath,
      order: Number.POSITIVE_INFINITY,
      children: [],
    };
    parentChildren.push(node);
    dirChildren.set(dirPath, node.children!);
    return node.children!;
  }

  for (const entry of entries) {
    if (!isPage(entry.kind)) continue;
    const slash = entry.path.lastIndexOf("/");
    const fileName = slash === -1 ? entry.path : entry.path.slice(slash + 1);
    const dirPath = slash === -1 ? "" : entry.path.slice(0, slash);
    ensureDir(dirPath).push({
      type: "file",
      title: entry.title?.trim() || humanize(stripExt(fileName)),
      urlPath: entry.path,
      fsPath: entry.path,
      order: Number.POSITIVE_INFINITY,
    });
  }

  sortTree(root);
  return root;
}

function isIndexNode(node: NavNode): boolean {
  return node.type === "file" && INDEX_RE.test(basename(node.fsPath));
}

function sortTree(nodes: NavNode[]): void {
  nodes.sort((a, b) => {
    const ai = isIndexNode(a) ? 0 : 1;
    const bi = isIndexNode(b) ? 0 : 1;
    if (ai !== bi) return ai - bi;
    return a.title.localeCompare(b.title);
  });
  for (const node of nodes) if (node.children) sortTree(node.children);
}

// Resolve the Entry Page path by precedence with no config (CONTEXT "Entry
// Page"): `index.html` -> `index.md` -> `README.md` -> otherwise the first
// Page directly inside `dir` (Markdown or HTML) alphabetically. The root is
// the degenerate case (`dir` omitted / ""), so one rule serves both — CONTEXT
// "Entry Page" now applies this to any directory in the Site, not just the
// root. M4 restores `index.html` to the front of the precedence now that HTML
// is a Page kind. A directory with only nested Pages falls back to the first
// Page under it by path.
export function pickEntryPath(entries: ManifestEntry[], dir = ""): string | undefined {
  const prefix = dir ? `${dir.replace(/\/+$/, "")}/` : "";
  const scoped = entries
    .filter((e) => isPage(e.kind) && e.path.startsWith(prefix))
    .map((e) => e.path);
  if (scoped.length === 0) return undefined;

  const relative = (p: string) => p.slice(prefix.length);
  const topLevel = scoped.filter((p) => !relative(p).includes("/"));
  const named = (name: string) =>
    topLevel.find((p) => relative(p).toLowerCase() === name);

  return (
    named("index.html") ??
    named("index.htm") ??
    named("index.md") ??
    named("readme.md") ??
    [...topLevel].sort((a, b) => a.localeCompare(b))[0] ??
    [...scoped].sort((a, b) => a.localeCompare(b))[0]
  );
}

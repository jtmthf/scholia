import { basename } from "node:path";
import { humanize } from "../util/text.js";
import { disambiguateSiblings } from "./disambiguate.js";
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
  /** Positional order within its directory in Nav order (0 = first), from
   *  frontmatter or _meta.json. Undefined means no explicit order — fall back
   *  to numeric-aware filename collation. */
  order?: number;
}

function stripExt(name: string): string {
  return name.replace(/\.(md|markdown|mdx|html?)$/i, "");
}

const INDEX_BASENAME_RE = /^(readme|index)$/i;
const INDEX_EXT_RE = /\.(md|markdown|mdx|html)$/i;

function isIndexFile(name: string): boolean {
  return INDEX_BASENAME_RE.test(stripExt(name)) && INDEX_EXT_RE.test(name);
}

// A Page (Markdown or HTML) appears in Nav and is entry-eligible; Assets do not.
function isPage(kind: ManifestEntry["kind"]): boolean {
  return kind === "markdown" || kind === "html";
}

// Shared ordering for Nav and Entry Page resolution (CONTEXT "Entry Page"):
// index/README floats first, then explicit order, then numeric-aware filename
// collation — never by label. Tree's `compare` layers `_meta.json` on top of
// this base.
export function compareEntryPaths(a: string, b: string, orderA?: number, orderB?: number): number {
  const aIsIndex = isIndexFile(basename(a));
  const bIsIndex = isIndexFile(basename(b));
  if (aIsIndex !== bIsIndex) return aIsIndex ? -1 : 1;

  const oa = orderA ?? Number.POSITIVE_INFINITY;
  const ob = orderB ?? Number.POSITIVE_INFINITY;
  if (oa !== ob) return oa - ob;

  return a.localeCompare(b, undefined, { numeric: true });
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
  disambiguateSiblings(root);
  return root;
}

function sortTree(nodes: NavNode[]): void {
  nodes.sort((a, b) => {
    return compareEntryPaths(basename(a.fsPath), basename(b.fsPath), a.order, b.order);
  });
  for (const node of nodes) if (node.children) sortTree(node.children);
}

// Resolve the Entry Page path by precedence with no config (CONTEXT "Entry
// Page"): `index.html` -> `index.md` -> `README.md` -> otherwise the first Page
// in that directory in Nav order, descending into subdirectories when the
// directory holds no Pages directly. One rule serves both root and subdirs.
// M4 restores `index.html` to the front of the precedence now that HTML is a
// Page kind.
export function pickEntryPath(entries: ManifestEntry[], dir = ""): string | undefined {
  const prefix = dir ? `${dir.replace(/\/+$/, "")}/` : "";
  const scoped = entries
    .filter((e) => isPage(e.kind) && e.path.startsWith(prefix))
    .map((e) => e.path);
  if (scoped.length === 0) return undefined;

  const relative = (p: string) => p.slice(prefix.length);
  const topLevel = scoped.filter((p) => !relative(p).includes("/"));
  const named = (name: string) => topLevel.find((p) => relative(p).toLowerCase() === name);

  return (
    named("index.html") ??
    named("index.md") ??
    named("readme.md") ??
    firstInNavOrder(entries, topLevel) ??
    firstInNavOrder(entries, scoped)
  );
}

// Return the first entry path (from `candidates`) when the entries are sorted
// by Nav order — index-first, then explicit order, then numeric-aware filename
// collation.
function firstInNavOrder(entries: ManifestEntry[], candidates: string[]): string | undefined {
  if (candidates.length === 0) return undefined;
  const map = new Map(entries.map((e) => [e.path, e]));
  const sorted = [...candidates].sort((a, b) => {
    const ea = map.get(a);
    const eb = map.get(b);
    return compareEntryPaths(a, b, ea?.order, eb?.order);
  });
  return sorted[0];
}

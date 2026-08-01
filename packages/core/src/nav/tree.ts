import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { parseFrontmatter } from "../util/frontmatter.js";
import { extractHeadings } from "../util/headings.js";
import { classifyFile, isDoc, toUrlPath } from "../util/paths.js";
import { readHtmlMeta } from "../ingest/html.js";
import { renderedText } from "../ingest/rendered-text.js";
import { humanize } from "../util/text.js";
import { disambiguateSiblings } from "./disambiguate.js";
import type { Heading, NavNode, DocRecord } from "../types.js";

export interface ScanResult {
  tree: NavNode[];
  docs: DocRecord[];
}

const INDEX_RE = /^(readme|index)$/i;

function stripExt(name: string): string {
  return name.replace(/\.(md|markdown|mdx|html?)$/i, "");
}

function orderOf(data: Record<string, unknown>): number {
  const raw = data.order ?? data.nav_order ?? data.sidebar_position;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

// Optional per-directory override file: an array of filenames defining order,
// or an object mapping filename -> display title (fumadocs-style _meta).
async function readMeta(dir: string): Promise<{ order: string[]; titles: Record<string, string> }> {
  for (const name of ["_meta.json", "meta.json"]) {
    try {
      const raw = await readFile(join(dir, name), "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return { order: parsed, titles: {} };
      if (parsed && typeof parsed === "object") {
        return { order: Object.keys(parsed), titles: parsed };
      }
    } catch {
      // no meta file here
    }
  }
  return { order: [], titles: {} };
}

function isIndexNode(node: NavNode): boolean {
  return node.type === "file" && INDEX_RE.test(stripExt(basename(node.fsPath)));
}

export async function scanTree(root: string): Promise<ScanResult> {
  const docs: DocRecord[] = [];

  async function walk(dir: string): Promise<NavNode[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const meta = await readMeta(dir);
    const nodes: NavNode[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);

      if (entry.isDirectory()) {
        const children = await walk(full);
        if (children.length === 0) continue;
        nodes.push({
          type: "dir",
          title: meta.titles[entry.name] ?? humanize(entry.name),
          urlPath: toUrlPath(root, full),
          fsPath: full,
          order: Number.POSITIVE_INFINITY,
          children,
        });
      } else if (isDoc(entry.name)) {
        // The two Page kinds carry their title and Outline in different places
        // (CONTEXT "Page"): frontmatter or a markdown `#` for a Markdown Page,
        // `<title>` or an `<h1>` element for an HTML Page. Search indexes the
        // text a reader would see either way.
        let fm: Record<string, unknown> = {};
        let content = "";
        let headings: Heading[] = [];
        let docTitle: string | undefined;
        try {
          const raw = await readFile(full, "utf8");
          if (classifyFile(entry.name) === "html") {
            const html = readHtmlMeta(raw);
            headings = html.headings;
            docTitle = html.title;
            content = renderedText(raw);
          } else {
            const parsed = parseFrontmatter(raw);
            fm = parsed.data;
            content = parsed.content;
            headings = extractHeadings(content);
            docTitle = headings.find((h) => h.depth === 1)?.text;
          }
        } catch {
          // Unreadable file — skip its metadata but still list it.
        }
        const title =
          meta.titles[entry.name] ??
          (typeof fm.title === "string" ? fm.title : undefined) ??
          docTitle ??
          humanize(stripExt(entry.name));
        const urlPath = toUrlPath(root, full);
        nodes.push({ type: "file", title, urlPath, fsPath: full, order: orderOf(fm) });
        docs.push({ urlPath, fsPath: full, title, body: content, headings });
      }
    }

    nodes.sort((a, b) => compare(a, b, meta.order));
    return nodes;
  }

  const tree = await walk(root);
  disambiguateSiblings(tree);
  return { tree, docs };
}

function compare(a: NavNode, b: NavNode, metaOrder: string[]): number {
  // README/index documents always float to the top of their directory.
  const ai = isIndexNode(a) ? 0 : 1;
  const bi = isIndexNode(b) ? 0 : 1;
  if (ai !== bi) return ai - bi;

  // Explicit _meta order wins next.
  const am = metaOrder.indexOf(basename(a.fsPath));
  const bm = metaOrder.indexOf(basename(b.fsPath));
  if (am !== -1 || bm !== -1) {
    return (am === -1 ? Infinity : am) - (bm === -1 ? Infinity : bm);
  }

  // Then frontmatter order, then by filename (not label) with numeric-aware
  // collation — never by title, so numbered conventions like `0001-…` stay in
  // sequence even once the label itself comes from prose (an H1), per CONTEXT
  // "Nav".
  if (a.order !== b.order) return a.order - b.order;
  return basename(a.fsPath).localeCompare(basename(b.fsPath), undefined, { numeric: true });
}

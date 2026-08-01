import { resolve, relative, sep, isAbsolute } from "node:path";

// Every extension that names a Page rather than an Asset (CONTEXT "Page"): a
// Markdown Page, its MDX flavour, or an HTML Page. `classifyFile` below says
// which kind; this only says "is one".
const DOC_EXTENSIONS = [".md", ".markdown", ".mdx", ".html", ".htm"];

export function isDoc(name: string): boolean {
  const lower = name.toLowerCase();
  return DOC_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isMdx(name: string): boolean {
  return name.toLowerCase().endsWith(".mdx");
}

// Classify a file within a Site for hosting (PLAN §5 M3/M4). `.md`/`.markdown`
// are Markdown Pages; `.html`/`.htm` are HTML Pages (M4); everything else —
// including `.mdx` — is an Asset (hosted MDX flattening is deferred, ADR-0012).
export function classifyFile(path: string): "markdown" | "html" | "asset" {
  if (/\.(md|markdown)$/i.test(path)) return "markdown";
  if (/\.html?$/i.test(path)) return "html";
  return "asset";
}

// Map a filesystem path to a server URL path, relative to the served root.
export function toUrlPath(root: string, fsPath: string): string {
  const rel = relative(root, fsPath).split(sep).join("/");
  return "/" + rel;
}

// Resolve a request URL path to an absolute filesystem path, refusing to
// escape the served root (directory-traversal guard).
export function resolveWithinRoot(root: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "");
  const clean = decoded.replace(/^\/+/, "");
  const target = resolve(root, clean);
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return target;
}

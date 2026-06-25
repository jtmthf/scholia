import { resolve, relative, sep, isAbsolute } from "node:path";

const DOC_EXTENSIONS = [".md", ".markdown", ".mdx"];

export function isDoc(name: string): boolean {
  const lower = name.toLowerCase();
  return DOC_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isMdx(name: string): boolean {
  return name.toLowerCase().endsWith(".mdx");
}

// Classify a file within a Site for hosting (PLAN §5 M3). Only `.md`/`.markdown`
// are Markdown Pages; everything else — including `.html` and `.mdx` — is an
// Asset in M3 (HTML Pages land in M4; hosted MDX flattening is deferred).
export function classifyFile(path: string): "markdown" | "asset" {
  return /\.(md|markdown)$/i.test(path) ? "markdown" : "asset";
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

// The viewer talks to the REST API over CORS. In dev that's the local server
// on :8787; in prod it's the app origin. Page content is loaded from the
// absolute `contentBase` the API returns (the content origin), not from here.
const API_BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:8787").replace(/\/+$/, "");

export interface NavNode {
  type: "file" | "dir";
  title: string;
  urlPath: string;
  fsPath: string;
  order: number;
  children?: NavNode[];
}

export interface PageMeta {
  path: string;
  kind: "markdown" | "html" | "asset";
  title: string;
}

export interface SiteMeta {
  slug: string;
  state: "open" | "read_only" | "frozen";
  version: number;
  entryPath: string;
  contentBase: string;
  nav: NavNode[];
  pages: PageMeta[];
}

export class SiteNotFoundError extends Error {
  constructor(slug: string) {
    super(`No Site at "${slug}".`);
    this.name = "SiteNotFoundError";
  }
}

export async function fetchSite(slug: string): Promise<SiteMeta> {
  const res = await fetch(`${API_BASE}/sites/${encodeURIComponent(slug)}`);
  if (res.status === 404) throw new SiteNotFoundError(slug);
  if (!res.ok) throw new Error(`Failed to load Site (${res.status}).`);
  return (await res.json()) as SiteMeta;
}

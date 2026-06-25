import { readFile, stat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, basename } from "node:path";
import net from "node:net";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import {
  renderMarkdown,
  renderMdx,
  scanTree,
  createSearchIndex,
  resolveWithinRoot,
  toUrlPath,
  isDoc,
  isMdx,
  extractHeadings,
  contentType,
  escapeHtml,
  parseFrontmatter,
  type NavNode,
  type DocRecord,
  type Heading,
} from "@collab/core";
import { renderPage } from "./render/layout.js";
import { watchPath } from "./watch.js";

export interface StartOptions {
  rootDir: string;
  singleFile?: string;
  port: number;
  host: string;
  mdxEnabled: boolean;
  open: boolean;
}

export interface RunningServer {
  url: string;
  close: () => Promise<void>;
}

const INDEX_NAMES = [
  "README.md", "readme.md", "Readme.md",
  "index.md", "index.mdx", "README.mdx",
];

// The browser client bundle + vendored KaTeX assets, produced by `tsup` into
// this package's dist/assets. The server runs from source (via tsx), so we
// resolve up one level from src/ to the package root.
const ASSETS_DIR = fileURLToPath(new URL("../dist/assets/", import.meta.url));

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveIndex(dir: string, docs: DocRecord[]): Promise<string | null> {
  for (const name of INDEX_NAMES) {
    const candidate = join(dir, name);
    if (await exists(candidate)) return candidate;
  }
  // Fall back to the first document under this directory.
  const first = docs.find((d) => d.fsPath.startsWith(dir));
  return first?.fsPath ?? null;
}

function checkPort(port: number, host: string): Promise<boolean> {
  return new Promise((res) => {
    const srv = net.createServer();
    srv.once("error", () => res(false));
    srv.once("listening", () => srv.close(() => res(true)));
    srv.listen(port, host);
  });
}

async function findPort(preferred: number, host: string): Promise<number> {
  for (let p = preferred; p < preferred + 25; p++) {
    if (await checkPort(p, host)) return p;
  }
  return preferred;
}

export async function startServer(opts: StartOptions): Promise<RunningServer> {
  const dirMode = !opts.singleFile;

  // Mutable state, refreshed on file changes.
  let tree: NavNode[] = [];
  let docs: DocRecord[] = [];
  const searchIndex = createSearchIndex();

  // Rendered HTML cached by file path + mtime, so repeat page loads skip the
  // unified/Shiki/KaTeX pipeline entirely. Invalidated when mtime advances.
  interface CacheEntry {
    mtimeMs: number;
    html: string;
    title: string;
    headings: Heading[];
  }
  const renderCache = new Map<string, CacheEntry>();

  async function refresh(): Promise<void> {
    if (dirMode) {
      const scan = await scanTree(opts.rootDir);
      tree = scan.tree;
      docs = scan.docs;
    } else {
      const file = opts.singleFile!;
      const raw = await readFile(file, "utf8").catch(() => "");
      const { data, content } = parseFrontmatter(raw);
      const headings = extractHeadings(content);
      const title =
        (typeof data.title === "string" ? data.title : undefined) ??
        headings.find((h) => h.depth === 1)?.text ??
        basename(file);
      docs = [
        {
          urlPath: toUrlPath(opts.rootDir, file),
          fsPath: file,
          title,
          body: content,
          headings,
        },
      ];
    }
    // Incremental — only re-tokenizes docs whose content actually changed.
    searchIndex.update(docs);
  }

  await refresh();

  const app = new Hono();
  const sseClients = new Set<any>();

  function broadcastReload(): void {
    for (const client of sseClients) {
      client.writeSSE({ data: "reload" }).catch(() => {});
    }
  }

  app.get("/__livereload", (c) =>
    streamSSE(c, async (stream) => {
      sseClients.add(stream);
      stream.onAbort(() => {
        sseClients.delete(stream);
      });
      await stream.writeSSE({ data: "connected" });
      while (!stream.aborted) {
        await stream.sleep(15000);
        if (stream.aborted) break;
        await stream.writeSSE({ data: "ping" });
      }
    }),
  );

  app.get("/search", (c) => {
    const q = c.req.query("q") ?? "";
    return c.json(searchIndex.query(q));
  });

  app.get("/__assets/*", async (c) => {
    const rest = c.req.path.replace(/^\/__assets\//, "");
    const filePath = resolveWithinRoot(ASSETS_DIR, rest);
    if (!filePath || !(await exists(filePath))) return c.notFound();
    const buf = await readFile(filePath);
    return c.body(new Uint8Array(buf), 200, { "Content-Type": contentType(filePath) });
  });

  app.get("*", async (c) => {
    const urlPath = c.req.path;

    // Single-file mode: every page request renders that one document.
    if (!dirMode) {
      return renderDoc(c, opts.singleFile!, false);
    }

    let target = resolveWithinRoot(opts.rootDir, urlPath);
    if (!target) return c.notFound();

    const info = await stat(target).catch(() => null);
    if (info?.isDirectory()) {
      const index = await resolveIndex(target, docs);
      if (!index) return c.notFound();
      target = index;
    } else if (!info) {
      // Try extension-less doc links (e.g. /guide -> /guide.md).
      const withMd = (await exists(target + ".md")) ? target + ".md" : null;
      const withMdx = !withMd && (await exists(target + ".mdx")) ? target + ".mdx" : null;
      target = withMd ?? withMdx ?? target;
      if (!(await exists(target))) return c.notFound();
    }

    if (isDoc(target)) return renderDoc(c, target, true);

    // Non-doc sibling file (image, etc.) referenced by a document.
    const buf = await readFile(target);
    return c.body(new Uint8Array(buf), 200, { "Content-Type": contentType(target) });
  });

  async function renderDoc(c: any, fsPath: string, showSidebar: boolean) {
    const currentPath = toUrlPath(opts.rootDir, fsPath);
    const useMdx = opts.mdxEnabled && isMdx(fsPath);

    let contentHtml: string;
    let title: string;
    let headings: Heading[] = [];

    const info = await stat(fsPath).catch(() => null);
    const cached = info ? renderCache.get(fsPath) : undefined;
    if (cached && info && cached.mtimeMs === info.mtimeMs) {
      contentHtml = cached.html;
      title = cached.title;
      headings = cached.headings;
    } else {
      const source = await readFile(fsPath, "utf8");
      try {
        const result = useMdx
          ? await renderMdx(source, pathToFileURL(fsPath).href)
          : await renderMarkdown(source);
        contentHtml = result.html;
        title = result.title ?? "collab";
        headings = result.headings;
        if (info) {
          renderCache.set(fsPath, { mtimeMs: info.mtimeMs, html: contentHtml, title, headings });
        }
      } catch (err) {
        // One bad document should not break the viewer — show the error inline.
        const message = err instanceof Error ? err.message : String(err);
        contentHtml = `<h1>Failed to render</h1><p>${escapeHtml(currentPath)}</p><pre class="render-error">${escapeHtml(message)}</pre>`;
        title = "Render error";
      }
    }

    const html = renderPage({
      title,
      contentHtml,
      headings,
      nav: tree,
      currentPath,
      showSidebar: showSidebar && tree.length > 0,
    });
    return c.html(html);
  }

  // Watch for changes -> refresh state -> tell browsers to reload.
  // A change that affects the doc set or nav (a .md/.mdx file, or a _meta.json)
  // triggers a rescan + incremental re-index; other changes (e.g. an image a
  // doc links to) just invalidate caches and reload.
  const watchTarget = opts.singleFile ?? opts.rootDir;
  const watcher = watchPath(watchTarget, (paths) => {
    for (const p of paths) renderCache.delete(p);
    const structural = paths.some(
      (p) => isDoc(p) || /(^|[\\/])_?meta\.json$/i.test(p),
    );
    const job = structural ? refresh() : Promise.resolve();
    job
      .then(broadcastReload)
      .catch((err) => console.error("[collab] refresh failed:", err));
  });

  const port = await findPort(opts.port, opts.host);
  const server = serve({ fetch: app.fetch, port, hostname: opts.host });

  const displayHost = opts.host === "0.0.0.0" ? "localhost" : opts.host;
  const url = `http://${displayHost}:${port}`;

  return {
    url,
    close: async () => {
      await watcher.close();
      await new Promise<void>((res) => server.close(() => res()));
    },
  };
}

import { readFile, stat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { basename, resolve as resolvePath } from "node:path";
import net from "node:net";
import { Hono, type Context } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import { serve, type ServerType } from "@hono/node-server";
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
  pickEntryPath,
  classifyFile,
  getProvenance,
  type NavNode,
  type DocRecord,
  type Heading,
  type ManifestEntry,
} from "@scholia/core";
import { renderPage } from "./render/layout.js";
import { watchPath } from "./watch.js";
import { resolveEditor, openInEditor } from "./editor.js";

export interface StartOptions {
  rootDir: string;
  singleFile?: string;
  port: number;
  host: string;
  mdxEnabled: boolean;
  open: boolean;
  // When true, a busy `port` is a hard error instead of falling back to the
  // next open one — used when the caller passed an explicit --port and means it.
  strictPort?: boolean;
}

export interface RunningServer {
  url: string;
  // The port actually bound (may differ from the requested one when strictPort
  // is off and the preferred port was taken).
  port: number;
  close: () => Promise<void>;
}

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

// Local Preview shares the Entry Page engine with the hosted path (CONTEXT
// "Local Preview"): build the same ManifestEntry shape from the scanned docs
// and defer to `pickEntryPath`, scoped to `dir`, instead of a divergent local
// copy of the precedence rule.
function resolveIndex(rootDir: string, dir: string, docs: DocRecord[]): string | null {
  const entries: ManifestEntry[] = docs.map((d) => ({
    path: d.urlPath.replace(/^\/+/, ""),
    title: d.title,
    kind: classifyFile(d.fsPath),
  }));
  const dirScope = toUrlPath(rootDir, dir).replace(/^\/+/, "");
  const entryPath = pickEntryPath(entries, dirScope);
  if (!entryPath) return null;
  const doc = docs.find((d) => d.urlPath.replace(/^\/+/, "") === entryPath);
  return doc?.fsPath ?? null;
}

// `localhost` is a DNS name, not an address: it resolves to ::1 on macOS and to
// 127.0.0.1 elsewhere. Binding it once therefore leaves the *other* loopback
// address refusing connections — the browser reaches the URL we print, but
// `curl 127.0.0.1:3000` fails against the very same server. So when the host is
// the default `localhost`, bind both addresses. An explicit --host is a
// deliberate choice and is honoured verbatim.
const LOOPBACK_ADDRESSES = ["127.0.0.1", "::1"];

type PortState = "free" | "busy" | "unavailable";

function probePort(port: number, host: string): Promise<PortState> {
  return new Promise((res) => {
    const srv = net.createServer();
    srv.once("error", (err: NodeJS.ErrnoException) => {
      // EADDRINUSE means the address works and something else holds the port;
      // anything else (EADDRNOTAVAIL, EAFNOSUPPORT) means we can't use this
      // address at all. Conflating the two would make a machine without IPv6
      // look like it had 25 busy ports in a row.
      res(err.code === "EADDRINUSE" ? "busy" : "unavailable");
    });
    srv.once("listening", () => srv.close(() => res("free")));
    srv.listen(port, host);
  });
}

async function resolveBindHosts(host: string): Promise<string[]> {
  if (host !== "localhost") return [host];
  // Port 0 asks "does this address family work here at all?", independent of
  // whether the preferred port happens to be taken.
  const bindable: string[] = [];
  for (const address of LOOPBACK_ADDRESSES) {
    if ((await probePort(0, address)) === "free") bindable.push(address);
  }
  // Neither loopback address probed clean, which is odd but not our problem to
  // solve — hand `localhost` back to Node and let it resolve as it sees fit
  // rather than refusing to start.
  return bindable.length > 0 ? bindable : [host];
}

async function findPort(preferred: number, hosts: string[], strict: boolean): Promise<number> {
  // A port is only usable if it's free on *every* address we intend to bind,
  // otherwise we'd claim one stack and fail on the other.
  const freeOnAll = async (port: number): Promise<boolean> => {
    for (const host of hosts) {
      if ((await probePort(port, host)) !== "free") return false;
    }
    return true;
  };

  if (await freeOnAll(preferred)) return preferred;
  // The caller asked for this exact port — don't silently move.
  if (strict) {
    throw new Error(
      `port ${preferred} is already in use. Free it, or omit --port to let scholia pick an open one.`,
    );
  }
  for (let p = preferred + 1; p < preferred + 25; p++) {
    if (await freeOnAll(p)) return p;
  }
  throw new Error(
    `no open port found in the range ${preferred}-${preferred + 24}. Free one up, or pass --port <port>.`,
  );
}

function listen(
  fetch: Parameters<typeof serve>[0]["fetch"],
  port: number,
  hostname: string,
): Promise<ServerType> {
  return new Promise((resolve, reject) => {
    const srv = serve({ fetch, port, hostname }, () => resolve(srv));
    // Stays attached after resolution on purpose: an 'error' with no listener
    // is an uncaught exception, and this server outlives the promise.
    srv.once("error", reject);
  });
}

export async function startServer(opts: StartOptions): Promise<RunningServer> {
  const dirMode = !opts.singleFile;

  // Mutable state, refreshed on file changes.
  let tree: NavNode[] = [];
  let docs: DocRecord[] = [];
  const searchIndex = createSearchIndex();

  // Rendered HTML cached by file path + mtime, so repeat page loads skip the
  // unified/Shiki/KaTeX pipeline entirely. Invalidated when mtime advances.
  // `source` rides along too, so a cache hit can still serve "Copy markdown"
  // without a second read of the file.
  interface CacheEntry {
    mtimeMs: number;
    html: string;
    title: string;
    headings: Heading[];
    source: string;
  }
  const renderCache = new Map<string, CacheEntry>();

  // Project identity for the topbar (ADR-0016/0017 furniture) — the served
  // root's own directory name, not the current Page's title.
  const rootName = basename(resolvePath(opts.rootDir));

  // Editor resolution is a one-time, best-effort probe (ADR-0017): the
  // result gates whether "Open in editor" is ever rendered, so a miss never
  // shows a broken button. `/__open` reuses this same resolution rather than
  // re-probing per request.
  const editor = await resolveEditor();

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
  const sseClients = new Set<SSEStreamingApi>();

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

  // ADR-0017: Local Preview spawns the user's editor from a guarded loopback
  // route. Registered before the catch-all "*" route below, same as
  // /__livereload, /search, and /__assets/* — a specific path must win over
  // the wildcard. Three guards, in order — each is load-bearing on a server
  // that binds loopback on both stacks (any tab in the user's browser can
  // reach it):
  //   1. POST only.
  //   2. Sec-Fetch-Site, when present, must be same-origin.
  //   3. The target path is resolved through the same resolveWithinRoot
  //      guard the page route uses, so a traversal cannot reach outside the
  //      served directory.
  // Only after all three pass do we check whether an editor resolved at
  // startup, and spawn it detached (no waiting on the child, no piping its
  // output back).
  app.all("/__open", async (c) => {
    if (c.req.method !== "POST") {
      return c.json({ ok: false, error: "method not allowed" }, 405);
    }

    const site = c.req.header("Sec-Fetch-Site");
    if (site && site !== "same-origin") {
      return c.json({ ok: false, error: "cross-site request rejected" }, 403);
    }

    const body = await c.req.json().catch(() => null);
    const requestedPath = typeof body?.path === "string" ? body.path : null;
    if (!requestedPath) {
      return c.json({ ok: false, error: "missing path" }, 400);
    }

    const target = dirMode ? resolveWithinRoot(opts.rootDir, requestedPath) : opts.singleFile!;
    if (!target) {
      return c.json({ ok: false, error: "path outside served root" }, 400);
    }
    if (!(await exists(target))) {
      return c.json({ ok: false, error: "file not found" }, 404);
    }

    if (!editor) {
      return c.json({ ok: false, error: "no editor available" }, 503);
    }

    openInEditor(editor, target);
    return c.json({ ok: true });
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
      const index = resolveIndex(opts.rootDir, target, docs);
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

  async function renderDoc(c: Context, fsPath: string, showNav: boolean) {
    const currentPath = toUrlPath(opts.rootDir, fsPath);
    const useMdx = opts.mdxEnabled && isMdx(fsPath);

    let contentHtml: string;
    let title: string;
    let headings: Heading[] = [];
    let source: string;

    const info = await stat(fsPath).catch(() => null);
    const cached = info ? renderCache.get(fsPath) : undefined;
    if (cached && info && cached.mtimeMs === info.mtimeMs) {
      contentHtml = cached.html;
      title = cached.title;
      headings = cached.headings;
      source = cached.source;
    } else {
      source = await readFile(fsPath, "utf8");
      try {
        const result = useMdx
          ? await renderMdx(source, pathToFileURL(fsPath).href)
          : await renderMarkdown(source);
        contentHtml = result.html;
        title = result.title ?? "scholia";
        headings = result.headings;
        if (info) {
          renderCache.set(fsPath, {
            mtimeMs: info.mtimeMs,
            html: contentHtml,
            title,
            headings,
            source,
          });
        }
      } catch (err) {
        // One bad document should not break the viewer — show the error inline.
        const message = err instanceof Error ? err.message : String(err);
        contentHtml = `<h1>Failed to render</h1><p>${escapeHtml(currentPath)}</p><pre class="render-error">${escapeHtml(message)}</pre>`;
        title = "Render error";
      }
    }

    // Provenance is read live (CONTEXT "Provenance") — recomputed per
    // request, not cached, so a dirty-tree flag tracks edits as they happen
    // rather than the state at server start.
    const provenance = await getProvenance(opts.rootDir);

    const html = renderPage({
      title,
      contentHtml,
      headings,
      nav: tree,
      currentPath,
      showNav: showNav && tree.length > 0,
      rootName,
      editorAvailable: editor !== null,
      sourceMarkdown: source,
      colophon: info
        ? { relPath: currentPath.replace(/^\/+/, ""), mtimeMs: info.mtimeMs, provenance }
        : null,
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
    const structural = paths.some((p) => isDoc(p) || /(^|[\\/])_?meta\.json$/i.test(p));
    const job = structural ? refresh() : Promise.resolve();
    job.then(broadcastReload).catch((err) => console.error("[scholia] refresh failed:", err));
  });

  const hosts = await resolveBindHosts(opts.host);
  const port = await findPort(opts.port, hosts, opts.strictPort ?? false);

  // One listener per address. The first has to succeed; a later one failing
  // (something grabbed the port between probe and bind) leaves the preview
  // working on the address that did bind instead of killing startup.
  const servers: ServerType[] = [];
  for (const hostname of hosts) {
    try {
      servers.push(await listen(app.fetch, port, hostname));
    } catch (err) {
      if (servers.length === 0) throw err;
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[scholia] could not also bind ${hostname}:${port} — ${message}`);
    }
  }

  const displayHost = opts.host === "0.0.0.0" ? "localhost" : opts.host;
  const url = `http://${displayHost}:${port}`;

  return {
    url,
    port,
    close: async () => {
      await watcher.close();
      await Promise.all(servers.map((s) => new Promise<void>((res) => s.close(() => res()))));
    },
  };
}

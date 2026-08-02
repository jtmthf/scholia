import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, resolve as resolvePath } from "node:path";
import net from "node:net";
import { Hono, type Context } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import { serve, type ServerType } from "@hono/node-server";
import {
  scanTree,
  createSearchIndex,
  resolveWithinRoot,
  toUrlPath,
  isDoc,
  extractHeadings,
  contentType,
  escapeHtml,
  parseFrontmatter,
  pickEntryPath,
  classifyFile,
  getProvenance,
  isValidHash,
  readHtmlMeta,
  renderedText,
  appendComment,
  ConversationError,
  createConversation,
  deleteComment,
  deleteConversation,
  editComment,
  listConversations,
  setReaction,
  setResolved,
  htmlToDerivedText,
  acceptsMarkdown,
  type NavNode,
  type DocRecord,
  type ManifestEntry,
} from "@scholia/core";
import { SidecarStore, resolveAuthor } from "@scholia/sidecar";
import { renderPage } from "./render/layout.js";
import { PageRenderer, type RenderedPage } from "./render/page.js";
import {
  anchorFromSelection,
  toConversationDTOs,
  toPagePath,
  type SelectionInput,
} from "./conversations.js";
import { watchPath } from "./watch.js";
import { resolveEditor, openInEditor } from "./editor.js";
import { checkOpenRequest, checkWriteRequest, isLocalView } from "./open-guard.js";

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
  // The editor to open files in, from `--editor` or ~/.scholia/config. Wins
  // over detection (ADR-0017); an unusable value falls back to detection.
  editorOverride?: string | null;
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
    order: d.order,
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

interface NodeBindings {
  incoming?: { socket?: { remoteAddress?: string } };
}

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

  // Renders Pages and caches them by path + mtime. It also computes each Page's
  // Source Map and content hash, which is what the comment layer anchors and
  // binds against (see ./render/page.ts).
  const pages = new PageRenderer({ mdxEnabled: opts.mdxEnabled });

  // Conversations live beside the content, in the served root (ADR-0018). The
  // author is resolved once at startup from git config — it does not change
  // while a preview is open, and asking git per keystroke would be silly.
  const sidecar = new SidecarStore(opts.rootDir);
  const author = await resolveAuthor(opts.rootDir);

  // Project identity for the topbar (ADR-0016/0017 furniture) — the served
  // root's own directory name, not the current Page's title.
  const rootName = basename(resolvePath(opts.rootDir));

  // Editor resolution is a one-time, best-effort probe (ADR-0017): the
  // result gates whether "Open in editor" is ever rendered, so a miss shows
  // "Copy path" instead of a broken button. `/__open` reuses this same
  // resolution rather than re-probing per request.
  const editor = await resolveEditor({
    rootDir: opts.rootDir,
    override: opts.editorOverride,
  });

  async function refresh(): Promise<void> {
    if (dirMode) {
      const scan = await scanTree(opts.rootDir);
      tree = scan.tree;
      docs = scan.docs;
    } else {
      const file = opts.singleFile!;
      const raw = await readFile(file, "utf8").catch(() => "");
      // Mirrors `scanTree`'s per-kind title/Outline resolution for the one Page
      // single-file mode serves (CONTEXT "Page").
      const html = classifyFile(file) === "html";
      const { data, content } = html ? { data: {}, content: "" } : parseFrontmatter(raw);
      const meta = html ? readHtmlMeta(raw) : null;
      const headings = meta ? meta.headings : extractHeadings(content);
      const title =
        (typeof data.title === "string" ? data.title : undefined) ??
        (meta ? meta.title : undefined) ??
        headings.find((h) => h.depth === 1)?.text ??
        basename(file);
      docs = [
        {
          urlPath: toUrlPath(opts.rootDir, file),
          fsPath: file,
          title,
          body: html ? renderedText(raw) : content,
          headings,
        },
      ];
    }
    // Incremental — only re-tokenizes docs whose content actually changed.
    searchIndex.update(docs);
  }

  await refresh();

  // @hono/node-server hands the underlying Node request through `c.env`, which
  // is how /__open reaches the socket's peer address. Declared optional: the
  // Hono app is a plain fetch handler and nothing guarantees a caller went
  // through the Node adapter.
  const app = new Hono<{ Bindings: NodeBindings }>();
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
  // the wildcard. The request-shape guards (POST only, same-origin, loopback
  // peer and Host, no proxy headers) live in ./open-guard.ts; the path guard
  // has to stay here because it needs the served root. Only after all of them
  // pass do we check whether an editor resolved at startup, and spawn it
  // detached (no waiting on the child, no piping its output back).
  app.all("/__open", async (c) => {
    const rejection = checkOpenRequest({
      method: c.req.method,
      header: (name) => c.req.header(name),
      remoteAddress: c.env.incoming?.socket?.remoteAddress,
    });
    if (rejection) {
      return c.json({ ok: false, error: rejection.error }, rejection.status);
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

  // ---------------------------------------------------------------------------
  // Conversations (ADR-0018): create and read, against the Sidecar in the served
  // root. Registered before the "*" catch-all, like every other /__ route.
  //
  // Unlike /__open these are not loopback-only. A Comment is data in the reader's
  // own tree rather than a process on their machine, and a Tunnel exists so a
  // guest can leave one (CONTEXT "Tunnel") — see checkWriteRequest.
  // ---------------------------------------------------------------------------

  // Where a Page's Source Map comes from at write time. Rendering is cached, so
  // The Source Map of the render the *reader* was looking at, or null.
  //
  // The `data-sm` ids in a selection describe one particular render, so mapping
  // them through a different one would silently produce a range into bytes the
  // reader never saw. The content hash they were given names that render, so it
  // is also the check: when it no longer matches what is on disk, the Anchor
  // simply carries no source range. That costs a secondary hint and keeps the
  // text-quote — the primary locator (ADR-0002) — exactly as captured.
  async function sourceMapAsRendered(pagePath: string, contentHash: string | null) {
    if (!contentHash) return null;
    const fsPath = dirMode ? resolveWithinRoot(opts.rootDir, pagePath) : opts.singleFile!;
    if (!fsPath || !isDoc(fsPath) || !(await exists(fsPath))) return null;
    const page = await pages.render(fsPath).catch(() => null);
    return page?.contentHash === contentHash ? page.sourceMap : null;
  }

  // Every route answers with the Page's whole Conversation list, including the
  // ones that changed it — so the client never has to merge a mutation into what
  // it already had (the CommentsPort contract, ADR-0030).
  async function respondWithConversations(c: Context, pagePath: string) {
    const conversations = await listConversations(sidecar, pagePath);
    return c.json({ conversations: toConversationDTOs(conversations, author) });
  }

  interface PageWrite {
    pagePath: string;
    input: Record<string, unknown>;
  }

  interface CommentWrite extends PageWrite {
    body: string;
    /** Present only when the caller sent a well-formed content hash. */
    contentHash: string | null;
    selection: SelectionInput | null;
  }

  // Every write route is guarded, parsed and scoped to a Page the same way, so
  // that part lives here rather than once per verb.
  async function readPageWrite(c: Context): Promise<PageWrite | Response> {
    const rejection = checkWriteRequest({
      method: c.req.method,
      header: (name) => c.req.header(name),
    });
    if (rejection) return c.json({ error: rejection.error }, rejection.status);

    const input = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const pagePath = toPagePath(typeof input.page === "string" ? input.page : "");
    if (!pagePath) return c.json({ error: "missing page" }, 400);

    return { pagePath, input };
  }

  // The two routes that carry a Comment body add its validation and binding.
  async function readCommentWrite(c: Context): Promise<CommentWrite | Response> {
    const write = await readPageWrite(c);
    if (write instanceof Response) return write;

    const { input } = write;
    const body = typeof input.body === "string" ? input.body.trim() : "";
    if (!body) return c.json({ error: "a comment needs a body" }, 400);

    // The hash is the Comment's binding, so anything that isn't one is dropped
    // rather than written: an unbindable Comment is better than a Comment bound
    // to a value that names nothing.
    const claimed: unknown = input.contentHash;
    const contentHash = typeof claimed === "string" && isValidHash(claimed) ? claimed : null;

    return {
      ...write,
      body,
      contentHash,
      selection: (input.selection ?? null) as SelectionInput,
    };
  }

  // Whether this reader is the Owner — the person at this machine (CONTEXT
  // "Owner"). The same test that decides whether "Open in editor" is offered
  // (ADR-0017): a Tunnel guest may comment, because that is what a Tunnel is
  // for, but moderating other people's Conversations stays with the host.
  function isOwner(c: Context): boolean {
    return isLocalView((name) => c.req.header(name));
  }

  // A refused command is the reader's answer, not a stack trace: `core` says why
  // in words fit to show, and its `code` says which kind of refusal it is. The
  // mapping onto statuses lives here rather than in core, which carries no HTTP.
  function refused(c: Context, err: unknown) {
    const message = err instanceof Error ? err.message : "that did not work";
    if (!(err instanceof ConversationError)) return c.json({ error: message }, 500);
    const status = { "not-found": 404, forbidden: 403, invalid: 400 } as const;
    return c.json({ error: message }, status[err.code]);
  }

  /**
   * A route that changes a Conversation.
   *
   * Every one of them is the same frame — guard and parse the write, run one
   * `core` command against the Sidecar, answer with the Page's whole Conversation
   * list — so the frame is here and each route below is only what it decides.
   */
  // Generic in the path so Hono's own inference still reaches `c.req.param`:
  // a route declared with `:id` gets a `string` back for it, not `string |
  // undefined`, exactly as it would if it were registered inline.
  function writeRoute<P extends string>(
    path: P,
    command: (c: Context<{ Bindings: NodeBindings }, P>, write: PageWrite) => Promise<unknown>,
  ): void {
    app.all(path, async (c) => {
      const write = await readPageWrite(c);
      if (write instanceof Response) return write;

      try {
        await command(c, write);
      } catch (err) {
        return refused(c, err);
      }

      return respondWithConversations(c, write.pagePath);
    });
  }

  app.get("/__conversations", async (c) => {
    const pagePath = toPagePath(c.req.query("page") ?? "");
    if (!pagePath) return c.json({ error: "missing page" }, 400);
    return respondWithConversations(c, pagePath);
  });

  app.all("/__conversations", async (c) => {
    const write = await readCommentWrite(c);
    if (write instanceof Response) return write;

    // A Page-level Conversation is the absence of a selection, not a special
    // kind of one (CONTEXT "Anchor").
    const anchor = write.selection?.quote?.exact
      ? anchorFromSelection(
          write.selection,
          await sourceMapAsRendered(write.pagePath, write.contentHash),
        )
      : null;

    await createConversation(sidecar, {
      pagePath: write.pagePath,
      body: write.body,
      anchor,
      author,
      // The hash the browser was given when the Page was rendered, handed back
      // rather than recomputed — that is what makes it the state the reader
      // actually commented on. Provenance is read live, as it is everywhere else
      // locally (CONTEXT "Provenance").
      ...(write.contentHash ? { contentHash: write.contentHash } : {}),
      provenance: await getProvenance(opts.rootDir),
    });

    return respondWithConversations(c, write.pagePath);
  });

  app.all("/__conversations/:id/comments", async (c) => {
    const write = await readCommentWrite(c);
    if (write instanceof Response) return write;

    try {
      await appendComment(sidecar, {
        conversationId: c.req.param("id"),
        body: write.body,
        author,
      });
    } catch (err) {
      return refused(c, err);
    }

    return respondWithConversations(c, write.pagePath);
  });

  // The rest of the verb set (ADR-0032). Each one is POST with an action in the
  // path rather than a DELETE or a PATCH, because `checkWriteRequest` is a
  // single same-origin POST guard and a second shape would be a second thing to
  // get right. None of them touches an existing document: every one appends.
  //
  // Editing and deleting a Comment additionally require the Owner, which the
  // domain rule alone would not give us here. `author` is resolved once at
  // startup from git config, so *every* writer on this server — the host and any
  // Tunnel guest — acts under the same name, and `comment.author === author` is
  // therefore true for all of them. Until a guest has an Identity of their own
  // (CONTEXT "Tunnel", issue #31), the only honest gate on touching words that
  // are already written is "are you the person at this machine". Commenting,
  // replying, reacting and resolving stay open, because those only ever add.

  function requireOwner(c: Context): void {
    if (!isOwner(c)) {
      throw new ConversationError(
        "forbidden",
        "only the reader at this machine can change a Comment that is already written",
      );
    }
  }

  writeRoute("/__conversations/:id/resolve", (c, write) => {
    // Strictly a boolean: anything else is a caller that meant one of the two
    // and cannot be assumed into the other.
    if (typeof write.input.resolved !== "boolean") {
      throw new ConversationError("invalid", "resolved must be true or false");
    }
    return setResolved(sidecar, {
      conversationId: c.req.param("id"),
      resolved: write.input.resolved,
      author,
    });
  });

  writeRoute("/__conversations/:id/comments/:commentId/edit", (c, write) => {
    requireOwner(c);
    const body = typeof write.input.body === "string" ? write.input.body.trim() : "";
    if (!body) throw new ConversationError("invalid", "a comment needs a body");

    return editComment(sidecar, {
      conversationId: c.req.param("id"),
      commentId: c.req.param("commentId"),
      body,
      author,
    });
  });

  writeRoute("/__conversations/:id/comments/:commentId/delete", (c) => {
    requireOwner(c);
    return deleteComment(sidecar, {
      conversationId: c.req.param("id"),
      commentId: c.req.param("commentId"),
      author,
      isOwner: true,
    });
  });

  writeRoute("/__conversations/:id/comments/:commentId/reactions", (c, write) =>
    setReaction(sidecar, {
      conversationId: c.req.param("id"),
      commentId: c.req.param("commentId"),
      emoji: typeof write.input.emoji === "string" ? write.input.emoji : "",
      author,
      // Absent means toggle, which is what a click on a chip means. A caller
      // that knows the state it wants says so.
      ...(typeof write.input.on === "boolean" ? { on: write.input.on } : {}),
    }),
  );

  writeRoute("/__conversations/:id/delete", (c) =>
    deleteConversation(sidecar, {
      conversationId: c.req.param("id"),
      author,
      isOwner: isOwner(c),
    }),
  );

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
      // Try extension-less Page links (e.g. /guide -> /guide.md), in the order a
      // reader most likely meant.
      let resolved: string | null = null;
      for (const ext of [".md", ".mdx", ".html", ".htm"]) {
        if (await exists(target + ext)) {
          resolved = target + ext;
          break;
        }
      }
      target = resolved ?? target;
      if (!(await exists(target))) return c.notFound();
    }

    if (isDoc(target)) {
      // ?raw or Accept: text/markdown → serve the Page's Source (Issue #64).
      // Uses the render cache so the source is read at most once — the render
      // above already ingested it, and we reuse that copy rather than re-reading
      // the file.
      const rawResp = await maybeServeRawSource(c, target);
      if (rawResp) return rawResp;
      return renderDoc(c, target, true);
    }

    // Non-doc sibling file (image, etc.) referenced by a document.
    const buf = await readFile(target);
    return c.body(new Uint8Array(buf), 200, { "Content-Type": contentType(target) });
  });

  // Serve the Page's Source (verbatim or derived) instead of its rendered HTML.
  // Returns null when the caller should proceed to render the Page normally.
  // Uses the render cache so the source bytes are read from disk at most once.
  async function maybeServeRawSource(c: Context, fsPath: string): Promise<Response | null> {
    const isRaw = c.req.query("raw") !== undefined;
    const wantMd = acceptsMarkdown(c.req.header("Accept") ?? null);
    if (!isRaw && !wantMd) return null;

    const kind = classifyFile(fsPath);
    // For HTML Pages, the render cache holds the source in page.source.
    // For Markdown/MDX Pages, same — read from cache to avoid re-reading.
    let source: string;
    try {
      const page = await pages.render(fsPath);
      source = page.source;
    } catch {
      return c.notFound();
    }

    // ?raw returns the Source verbatim with the correct Content-Type.
    if (isRaw) {
      const ct = kind === "html" ? "text/html; charset=utf-8" : "text/markdown; charset=utf-8";
      return c.body(source, 200, {
        "Content-Type": ct,
        "X-Content-Type-Options": "nosniff",
        "X-Scholia-Source": "verbatim",
      });
    }

    // Accept: text/markdown — negotiate the Source representation.
    c.header("Vary", "Accept");
    if (kind === "html") {
      // Best-effort derived text — NOT the Source, NOT safe for source ranges.
      return c.body(htmlToDerivedText(source), 200, {
        "Content-Type": "text/markdown; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "X-Scholia-Source": "derived",
      });
    }
    // Markdown Page: the Source _is_ text/markdown.
    return c.body(source, 200, {
      "Content-Type": "text/markdown; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Scholia-Source": "verbatim",
    });
  }

  async function renderDoc(c: Context, fsPath: string, showNav: boolean) {
    const currentPath = toUrlPath(opts.rootDir, fsPath);
    const pagePath = toPagePath(currentPath);
    const info = await stat(fsPath).catch(() => null);

    let page: RenderedPage | null = null;
    let failure: string | null = null;
    try {
      page = await pages.render(fsPath);
    } catch (err) {
      // One bad document should not break the viewer — show the error inline.
      failure = err instanceof Error ? err.message : String(err);
    }

    // Provenance is read live (CONTEXT "Provenance") — recomputed per
    // request, not cached, so a dirty-tree flag tracks edits as they happen
    // rather than the state at server start.
    const provenance = await getProvenance(opts.rootDir);

    // Conversations are fetched and rendered server-side so the comment rail is
    // in the first response like every other piece of chrome (ADR-0011). The
    // client hydrates that markup rather than fetching it back.
    const conversations = page
      ? toConversationDTOs(await listConversations(sidecar, pagePath), author)
      : [];

    const html = renderPage({
      title: page?.title ?? "Render error",
      contentHtml:
        page?.contentHtml ??
        `<h1>Failed to render</h1><p>${escapeHtml(currentPath)}</p><pre class="render-error">${escapeHtml(failure ?? "")}</pre>`,
      pageStyles: page?.styleHtml ?? "",
      headings: page?.headings ?? [],
      nav: tree,
      currentPath,
      showNav: showNav && tree.length > 0,
      rootName,
      // Two conditions, not one: an editor has to have resolved at startup,
      // *and* this reader has to be the person at this machine. /__open would
      // refuse a LAN or tunnelled request (ADR-0022), so offering them the
      // button would be offering a guaranteed 403.
      editorAvailable: editor !== null && isLocalView((name) => c.req.header(name)),
      filePath: fsPath,
      sourceMarkdown: page?.source ?? "",
      colophon: info ? { relPath: pagePath, mtimeMs: info.mtimeMs, provenance } : null,
      comments: page
        ? {
            pagePath,
            // Taken from the render, not re-read at submit: the Comment binds to
            // the bytes that produced what the reader is looking at (AC / CONTEXT
            // "Comment"). A render error has no Page to bind to, so no rail.
            contentHash: page.contentHash,
            displayName: author,
            // The same test as the editor button above, for the same reason: a
            // moderation control a tunnelled guest would only ever get a 403
            // from is a broken button (ADR-0017, ADR-0022).
            canModerate: isOwner(c),
            conversations,
          }
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
    for (const p of paths) pages.invalidate(p);
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

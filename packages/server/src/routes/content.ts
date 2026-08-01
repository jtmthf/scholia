import { Hono } from "hono";
import type { Context } from "hono";
import { describeRoute } from "hono-openapi";
import { contentType, pickEntryPath, rewriteInterPageLinks, htmlToDerivedText, acceptsMarkdown } from "@scholia/core";
import { getLatestManifest, getManifestByOrdinal, type PageEntry } from "@scholia/db";
import type { AppDeps } from "../config.js";
import { renderContentDocument, prepareHtmlDocument } from "../content.js";
import { contentCsp } from "../content-origin.js";

const decoder = new TextDecoder();

// The content origin (ADR-0003). Serves Markdown Pages and HTML Pages as
// standalone documents into the sandboxed cross-origin iframe, and Assets as raw
// bytes. M4: HTML Pages render alongside Markdown, CSP + noindex + no-referrer.
// M6: `/v/:ordinal/...` routes serve a historical Version (read-only permalink,
// CONTEXT "Latest"); the un-versioned routes always serve Latest.
export function contentRoutes(getDeps: () => AppDeps) {
  const app = new Hono();

  // ---- Version-pinned (registered first; static `v` segment wins over `*`) ----

  app.get("/content/sites/:slug/v/:ordinal", async (c) => {
    const deps = getDeps();
    const slug = c.req.param("slug");
    const ordinal = Number(c.req.param("ordinal"));
    if (!Number.isInteger(ordinal) || ordinal < 1) return c.notFound();
    const manifest = await getManifestByOrdinal(deps.db, slug, ordinal);
    if (!manifest) return c.notFound();
    return serveEntry(c, deps, slug, manifest.pages);
  });

  app.get("/content/sites/:slug/v/:ordinal/*", async (c) => {
    const deps = getDeps();
    const slug = c.req.param("slug");
    const ordinal = Number(c.req.param("ordinal"));
    if (!Number.isInteger(ordinal) || ordinal < 1) return c.notFound();
    const manifest = await getManifestByOrdinal(deps.db, slug, ordinal);
    if (!manifest) return c.notFound();
    const prefix = `/content/sites/${slug}/v/${ordinal}/`;
    const pagePath = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : "";
    return servePath(c, deps, slug, manifest.pages, pagePath);
  });

  // ---- Latest ----

  app.get("/content/sites/:slug", async (c) => {
    const deps = getDeps();
    const slug = c.req.param("slug");
    const manifest = await getLatestManifest(deps.db, slug);
    if (!manifest) return c.notFound();
    return serveEntry(c, deps, slug, manifest.pages);
  });

  app.get(
    "/content/sites/:slug/*",
    describeRoute({
      summary: "Serve a rendered Page or raw Asset",
      description:
        "Returns a rendered HTML document for Markdown/HTML Pages (for the sandboxed iframe) " +
        "or raw bytes for Assets. Add `?raw` to return the Page's Source verbatim " +
        "(the canonical authored bytes). Send `Accept: text/markdown` to negotiate " +
        "the Source representation for Markdown Pages, or a best-effort derived " +
        "text for HTML Pages.",
      operationId: "serveContent",
      parameters: [
        { name: "slug", in: "path", required: true, schema: { type: "string" } },
      ],
    }),
    async (c) => {
      const deps = getDeps();
      const slug = c.req.param("slug");
      const manifest = await getLatestManifest(deps.db, slug);
      if (!manifest) return c.notFound();
      const prefix = `/content/sites/${slug}/`;
      const pagePath = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : "";
      return servePath(c, deps, slug, manifest.pages, pagePath);
    },
  );

  return app;
}

function baseHeaders() {
  return {
    "X-Robots-Tag": "noindex",
    "Referrer-Policy": "no-referrer",
  } as const;
}

// Serve the Page's Source (verbatim or derived) instead of its rendered HTML.
// Returns a Response when the request asks for source; returns null when the
// caller should proceed to serve the rendered Page.
async function maybeServeSource(
  c: Context,
  deps: AppDeps,
  page: PageEntry,
): Promise<Response | null> {
  // `?raw` returns the Source verbatim (CONTEXT "Source"). Byte-exact, so
  // Anchor source ranges remain valid against it. Content-Type reflects the
  // Page's kind — text/markdown for Markdown Pages, text/html for HTML Pages.
  if (c.req.query("raw") !== undefined) {
    const bytes = await deps.store.get(page.contentHash);
    if (!bytes) return c.notFound();
    const ct = page.kind === "html" ? "text/html; charset=utf-8" : "text/markdown; charset=utf-8";
    return c.body(bytes as unknown as Uint8Array<ArrayBuffer>, 200, {
      "Content-Type": ct,
      "X-Content-Type-Options": "nosniff",
      "X-Scholia-Source": "verbatim",
      ...baseHeaders(),
    });
  }

  // `Accept: text/markdown` negotiates the Source representation.
  // - Markdown Page: same bytes as `?raw` (the Source).
  // - HTML Page: best-effort derived text — NOT the Source, NOT safe for
  //   constructing source ranges (Issue #64: "Source vs representation").
  if (acceptsMarkdown(c.req.header("Accept") ?? null)) {
    const bytes = await deps.store.get(page.contentHash);
    if (!bytes) return c.notFound();
    c.header("Vary", "Accept");
    if (page.kind === "html") {
      const text = htmlToDerivedText(decoder.decode(bytes));
      return c.body(text, 200, {
        "Content-Type": "text/markdown; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "X-Scholia-Source": "derived",
        ...baseHeaders(),
      });
    }
    // Markdown Page: the Source _is_ text/markdown.
    return c.body(bytes as unknown as Uint8Array<ArrayBuffer>, 200, {
      "Content-Type": "text/markdown; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Scholia-Source": "verbatim",
      ...baseHeaders(),
    });
  }

  return null;
}

// Resolve the Entry Page for a manifest and serve it.
async function serveEntry(c: Context, deps: AppDeps, slug: string, pages: PageEntry[]) {
  const entryPath = pickEntryPath(pages);
  if (!entryPath) return c.notFound();
  const page = pages.find((p) => p.path === entryPath);
  if (!page) return c.notFound();

  const sourceResp = await maybeServeSource(c, deps, page);
  if (sourceResp) return sourceResp;

  if (!page.renderedHash) return c.notFound();
  return servePage(c, deps, slug, pages, page as PageEntry & { renderedHash: string });
}

// Serve a specific Site-relative path (Page or Asset) within a manifest.
async function servePath(
  c: Context,
  deps: AppDeps,
  slug: string,
  pages: PageEntry[],
  pagePath: string,
) {
  if (!pagePath) return c.notFound();
  const page = pages.find((p) => p.path === pagePath);
  if (!page) return c.notFound();

  if (page.kind === "asset") {
    const bytes = await deps.store.get(page.contentHash);
    if (!bytes) return c.notFound();
    return c.body(bytes as unknown as Uint8Array<ArrayBuffer>, 200, {
      "Content-Type": contentType(pagePath),
      ...baseHeaders(),
    });
  }

  const sourceResp = await maybeServeSource(c, deps, page);
  if (sourceResp) return sourceResp;

  if (!page.renderedHash) return c.notFound();
  return servePage(c, deps, slug, pages, page as PageEntry & { renderedHash: string });
}

// Serve a Page (Markdown or HTML) as a document into the sandboxed iframe. Both
// kinds get serve-time inter-page link rewriting (links to any Page in the Site
// navigate the top frame to the viewer route, keeping the chrome), a CSP, and
// the noindex/no-referrer headers.
async function servePage(
  c: Context,
  deps: AppDeps,
  slug: string,
  pages: PageEntry[],
  page: PageEntry & { renderedHash: string },
) {
  const bytes = await deps.store.get(page.renderedHash);
  if (!bytes) return c.notFound();

  // Both Page kinds are link targets in a Site (CONTEXT "Nav").
  const pagePaths = new Set(
    pages.filter((p) => p.kind === "markdown" || p.kind === "html").map((p) => p.path),
  );
  const rewritten = rewriteInterPageLinks(decoder.decode(bytes), {
    pagePath: page.path,
    pagePaths,
    viewerBase: deps.viewerUrl,
    slug,
  });

  const html =
    page.kind === "html"
      ? prepareHtmlDocument(rewritten)
      : renderContentDocument(rewritten, page.title ?? page.path);

  return c.html(html, 200, {
    ...baseHeaders(),
    "Content-Security-Policy": contentCsp(deps),
  });
}

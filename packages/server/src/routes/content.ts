import { Hono } from "hono";
import type { Context } from "hono";
import { contentType, pickEntryPath, rewriteInterPageLinks } from "@collab/core";
import { getLatestManifest, type PageEntry } from "@collab/db";
import type { AppDeps } from "../config.js";
import { renderContentDocument, prepareHtmlDocument } from "../content.js";
import { contentCsp } from "../content-origin.js";

const decoder = new TextDecoder();

// The content origin (ADR-0003). Serves Markdown Pages and HTML Pages as
// standalone documents into the sandboxed cross-origin iframe, and Assets as raw
// bytes. M4: HTML Pages render alongside Markdown in the same iframe, documents
// carry a `Content-Security-Policy` (frame-ancestors pinned to the viewer +
// locked-down outbound), and all responses keep noindex + no-referrer (PLAN §2).
export function contentRoutes(getDeps: () => AppDeps) {
  const app = new Hono();

  // Entry page: resolve via pickEntryPath over the full manifest.
  app.get("/content/sites/:slug", async (c) => {
    const deps = getDeps();
    const slug = c.req.param("slug");
    const manifest = await getLatestManifest(deps.db, slug);
    if (!manifest) return c.notFound();

    const entryPath = pickEntryPath(manifest.pages);
    if (!entryPath) return c.notFound();

    const page = manifest.pages.find((p) => p.path === entryPath);
    if (!page || !page.renderedHash) return c.notFound();

    return servePage(c, deps, slug, manifest.pages, page as PageEntry & { renderedHash: string });
  });

  // Specific page or asset by Site-relative path.
  app.get("/content/sites/:slug/*", async (c) => {
    const deps = getDeps();
    const slug = c.req.param("slug");
    const manifest = await getLatestManifest(deps.db, slug);
    if (!manifest) return c.notFound();

    // Strip the fixed prefix to get the Site-relative path.
    const prefix = `/content/sites/${slug}/`;
    const pagePath = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : "";
    if (!pagePath) return c.notFound();

    const page = manifest.pages.find((p) => p.path === pagePath);
    if (!page) return c.notFound();

    if (page.kind === "asset") {
      const bytes = await deps.store.get(page.contentHash);
      if (!bytes) return c.notFound();
      return c.body(bytes as unknown as Uint8Array<ArrayBuffer>, 200, {
        "Content-Type": contentType(pagePath),
        ...baseHeaders(),
      });
    }

    if (!page.renderedHash) return c.notFound();
    return servePage(c, deps, slug, manifest.pages, page as PageEntry & { renderedHash: string });
  });

  return app;
}

function baseHeaders() {
  return {
    "X-Robots-Tag": "noindex",
    "Referrer-Policy": "no-referrer",
  } as const;
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

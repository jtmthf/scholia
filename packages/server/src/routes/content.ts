import { Hono } from "hono";
import type { Context } from "hono";
import { contentType, pickEntryPath, rewriteInterPageLinks } from "@collab/core";
import { getLatestManifest, type PageEntry } from "@collab/db";
import type { AppDeps } from "../config.js";
import { renderContentDocument } from "../content.js";

const decoder = new TextDecoder();

const CONTENT_HEADERS = {
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer",
} as const;

// The content origin (ADR-0003). Serves Markdown Pages as standalone HTML
// documents and Assets as raw bytes, both with noindex + no-referrer headers
// (PLAN §2). M3: multi-page Sites with inter-page link rewriting and asset
// serving. Per-Site content subdomain + CSP land in M4.
export function contentRoutes(getDeps: () => AppDeps) {
  const app = new Hono();

  // Entry page: resolve via pickEntryPath over the full manifest.
  app.get("/content/sites/:slug", async (c) => {
    const { db, store, viewerUrl } = getDeps();
    const slug = c.req.param("slug");
    const manifest = await getLatestManifest(db, slug);
    if (!manifest) return c.notFound();

    const entryPath = pickEntryPath(manifest.pages);
    if (!entryPath) return c.notFound();

    const page = manifest.pages.find((p) => p.path === entryPath);
    if (!page || !page.renderedHash) return c.notFound();

    return serveMarkdown(c, store, viewerUrl, slug, manifest.pages, page as PageEntry & { renderedHash: string });
  });

  // Specific page or asset by Site-relative path.
  app.get("/content/sites/:slug/*", async (c) => {
    const { db, store, viewerUrl } = getDeps();
    const slug = c.req.param("slug");
    const manifest = await getLatestManifest(db, slug);
    if (!manifest) return c.notFound();

    // Strip the fixed prefix to get the Site-relative path.
    const prefix = `/content/sites/${slug}/`;
    const pagePath = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : "";
    if (!pagePath) return c.notFound();

    const page = manifest.pages.find((p) => p.path === pagePath);
    if (!page) return c.notFound();

    if (page.kind === "asset") {
      const bytes = await store.get(page.contentHash);
      if (!bytes) return c.notFound();
      return c.body(bytes as unknown as Uint8Array<ArrayBuffer>, 200, {
        "Content-Type": contentType(pagePath),
        ...CONTENT_HEADERS,
      });
    }

    if (!page.renderedHash) return c.notFound();
    return serveMarkdown(c, store, viewerUrl, slug, manifest.pages, page as PageEntry & { renderedHash: string });
  });

  return app;
}

async function serveMarkdown(
  c: Context,
  store: AppDeps["store"],
  viewerUrl: string,
  slug: string,
  pages: PageEntry[],
  page: PageEntry & { renderedHash: string },
) {
  const bytes = await store.get(page.renderedHash);
  if (!bytes) return c.notFound();

  const pagePaths = new Set(pages.filter((p) => p.kind === "markdown").map((p) => p.path));
  const fragment = rewriteInterPageLinks(decoder.decode(bytes), {
    pagePath: page.path,
    pagePaths,
    viewerBase: viewerUrl,
    slug,
  });
  const html = renderContentDocument(fragment, page.title ?? page.path);
  return c.html(html, 200, CONTENT_HEADERS);
}

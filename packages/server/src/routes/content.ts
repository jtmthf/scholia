import { Hono } from "hono";
import { getLatestPage } from "@collab/db";
import type { AppDeps } from "../config.js";
import { renderContentDocument } from "../content.js";

const decoder = new TextDecoder();

// The content origin (ADR-0003). Serves a Page's rendered HTML as a standalone
// document loaded inside the sandboxed iframe. M2 serves from a path on this
// server; the per-Site content subdomain + CSP land in M4. Responses carry
// noindex + no-referrer (PLAN §2).
export function contentRoutes(getDeps: () => AppDeps) {
  const app = new Hono();

  app.get("/content/sites/:slug", async (c) => {
    const { db, store } = getDeps();
    const result = await getLatestPage(db, c.req.param("slug"));
    if (!result?.page.renderedHash) return c.notFound();

    const bytes = await store.get(result.page.renderedHash);
    if (!bytes) return c.notFound();

    const html = renderContentDocument(
      decoder.decode(bytes),
      result.page.title ?? result.page.path,
    );
    return c.html(html, 200, {
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    });
  });

  return app;
}

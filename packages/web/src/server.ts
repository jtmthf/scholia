import { Hono } from "hono";
import { render } from "./entry-server.js";
import type { Assets } from "./document.js";

/**
 * The viewer's own server (ADR-0011). Deliberately thin: it exists to render the
 * shell for a URL, and it is the same Hono idiom as the API and Local Preview.
 *
 * It stays a separate origin from the API and reads Site data over HTTP like any
 * other client — the viewer has no database credentials and shouldn't grow any.
 */
export function createApp(assets: Assets) {
  const app = new Hono();

  // Liveness, matching the API server's. It has to exist because every other path
  // is a Site URL or a 404, so there is nothing a process supervisor — or
  // Playwright's `webServer.url` — could otherwise poll for a 200.
  app.get("/health", (c) => c.json({ ok: true }));

  // Every other URL renders the app: `/s/:slug/...` resolves a Site, and anything else
  // renders the not-found view with a 404. A rewritten inter-Page link inside the
  // content iframe top-navigates here (target="_top"), so these are real cold loads,
  // not just the client router's business.
  app.get("*", async (c) => {
    const { html, status } = await render(c.req.url, assets);
    return c.html(html, status as 200);
  });

  return app;
}

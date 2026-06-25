import { Hono } from "hono";
import { storeMarkdownPage } from "@collab/core";
import { createSiteWithVersion, getLatestPage, type Provenance } from "@collab/db";
import type { AppDeps } from "../config.js";
import { hashToken, mintToken, randomSlug } from "../tokens.js";

interface ShareBody {
  filename: string;
  content: string;
  provenance?: Provenance;
}

// Reduce an uploaded filename to a Page path. M2 hosts a single Markdown Page,
// so this is just the basename (folders/zips become real tree paths in M3).
function pagePath(filename: string): string {
  const base = filename.split(/[\\/]/).pop()?.trim();
  return base && base.length > 0 ? base : "index.md";
}

// `collab share` and `GET /sites/:slug`. M2: one public Markdown Page per Site.
export function sitesRoutes(getDeps: () => AppDeps) {
  const app = new Hono();

  // Create a Site from a single Markdown file: ingest + store blobs, mint the
  // Site slug + owner token, persist the first Version. Returns the Share URL
  // and the one-time owner token (PLAN §5 M2, ADR-0005).
  app.post("/sites", async (c) => {
    const body = (await c.req.json().catch(() => null)) as ShareBody | null;
    if (!body || typeof body.content !== "string" || typeof body.filename !== "string") {
      return c.json({ error: "expected JSON { filename, content }" }, 400);
    }

    const { db, store, viewerUrl } = getDeps();
    const path = pagePath(body.filename);
    const stored = await storeMarkdownPage(store, body.content);

    const slug = randomSlug();
    const token = mintToken();
    await createSiteWithVersion(db, {
      slug,
      ownerTokenHash: hashToken(token),
      contentSource: { kind: "local" },
      provenance: body.provenance ?? null,
      pages: [
        {
          path,
          kind: "markdown",
          contentHash: stored.contentHash,
          title: stored.title ?? null,
          renderedHash: stored.renderedHash,
          sourceMapHash: stored.sourceMapHash,
        },
      ],
    });

    return c.json(
      {
        slug,
        shareUrl: `${viewerUrl}/s/${slug}`,
        token,
        page: { path, title: stored.title ?? path },
      },
      201,
    );
  });

  // Site metadata for the viewer: resolves the Entry Page and the absolute URL
  // its content loads from (the iframe src).
  app.get("/sites/:slug", async (c) => {
    const { db, publicUrl } = getDeps();
    const result = await getLatestPage(db, c.req.param("slug"));
    if (!result) return c.json({ error: "not found" }, 404);

    const { site, page } = result;
    return c.json({
      slug: site.slug,
      state: site.state,
      version: page.ordinal,
      page: {
        path: page.path,
        kind: page.kind,
        title: page.title ?? page.path,
        contentUrl: `${publicUrl}/content/sites/${site.slug}`,
      },
    });
  });

  return app;
}

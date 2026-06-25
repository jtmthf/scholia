import { Hono } from "hono";
import { buildNav, pickEntryPath, storeMarkdownPage } from "@collab/core";
import {
  createSiteWithVersion,
  getLatestManifest,
  type NewPage,
  type Provenance,
} from "@collab/db";
import type { AppDeps } from "../config.js";
import { hashToken, mintToken, randomSlug } from "../tokens.js";

interface FileEntry {
  path: string;
  kind: "markdown" | "asset";
  contentHash: string;
}

interface SiteBody {
  contentSource: { kind: "local" };
  provenance?: Provenance;
  files: FileEntry[];
}

function isFileEntry(v: unknown): v is FileEntry {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.path === "string" &&
    (obj.kind === "markdown" || obj.kind === "asset") &&
    typeof obj.contentHash === "string"
  );
}

// `collab share` and `GET /sites/:slug`. M3: multi-page Sites with blob
// negotiation — client uploads blobs first, then submits the manifest.
export function sitesRoutes(getDeps: () => AppDeps) {
  const app = new Hono();

  // Create a Site from a pre-uploaded manifest. The client must have already
  // PUT all blob hashes via /blobs before calling this.
  app.post("/sites", async (c) => {
    const body = (await c.req.json().catch(() => null)) as SiteBody | null;
    if (
      !body ||
      typeof body.contentSource !== "object" ||
      body.contentSource?.kind !== "local" ||
      !Array.isArray(body.files) ||
      body.files.length === 0 ||
      !body.files.every(isFileEntry)
    ) {
      return c.json(
        { error: "expected JSON { contentSource: {kind:'local'}, files: [{path,kind,contentHash},...] }" },
        400,
      );
    }

    const { db, store, viewerUrl } = getDeps();

    // Verify every content hash is already in the store.
    const missingChecks = await Promise.all(
      body.files.map(async (f) => ({ path: f.path, has: await store.has(f.contentHash) })),
    );
    const missing = missingChecks.filter((c) => !c.has).map((c) => c.path);
    if (missing.length > 0) {
      return c.json({ error: "blobs missing; upload them first", missing }, 409);
    }

    // Process each file into a manifest row.
    const pages: NewPage[] = await Promise.all(
      body.files.map(async (f): Promise<NewPage> => {
        if (f.kind !== "markdown") {
          return { path: f.path, kind: "asset", contentHash: f.contentHash };
        }
        const raw = await store.get(f.contentHash);
        const source = new TextDecoder().decode(raw!);
        const stored = await storeMarkdownPage(store, source);
        return {
          path: f.path,
          kind: "markdown",
          contentHash: f.contentHash,
          title: stored.title ?? null,
          renderedHash: stored.renderedHash,
          sourceMapHash: stored.sourceMapHash,
        };
      }),
    );

    const slug = randomSlug();
    const token = mintToken();
    await createSiteWithVersion(db, {
      slug,
      ownerTokenHash: hashToken(token),
      contentSource: { kind: "local" },
      provenance: body.provenance ?? null,
      pages,
    });

    const entryPath = pickEntryPath(body.files);
    return c.json({ slug, shareUrl: `${viewerUrl}/s/${slug}`, token, entryPath }, 201);
  });

  // Site metadata: Nav tree, entry path, content base URL, and the full page list.
  app.get("/sites/:slug", async (c) => {
    const { db, publicUrl } = getDeps();
    const manifest = await getLatestManifest(db, c.req.param("slug"));
    if (!manifest) return c.json({ error: "not found" }, 404);

    const { site, ordinal, pages } = manifest;
    const entryPath = pickEntryPath(pages);
    return c.json({
      slug: site.slug,
      state: site.state,
      version: ordinal,
      entryPath,
      contentBase: `${publicUrl}/content/sites/${site.slug}`,
      nav: buildNav(pages),
      pages: pages.map((p) => ({ path: p.path, kind: p.kind, title: p.title ?? p.path })),
    });
  });

  return app;
}

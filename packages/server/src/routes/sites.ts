import { Hono } from "hono";
import { buildNav, pickEntryPath } from "@collab/core";
import {
  addVersionWithManifest,
  createSiteWithVersion,
  deleteSite,
  getLatestManifest,
  getManifestByOrdinal,
  listTokens,
  revokeToken,
  rotateOwnerToken,
  rotateSlug,
  setSiteState,
  type Provenance,
} from "@collab/db";
import type { AppDeps } from "../config.js";
import { contentBaseFor } from "../content-origin.js";
import { hashToken, mintToken, randomSlug } from "../tokens.js";
import { authorizeOwner } from "../auth.js";
import {
  buildManifestPages,
  checkUploadLimits,
  isFileEntry,
  missingBlobs,
  type FileEntry,
} from "../manifest.js";
import { migrateConversationsToLatest } from "../migration.js";

interface SiteBody {
  contentSource: { kind: "local" };
  provenance?: Provenance;
  files: FileEntry[];
}

function validBody(body: unknown): body is SiteBody {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  const cs = b.contentSource as Record<string, unknown> | undefined;
  return (
    typeof cs === "object" &&
    cs !== null &&
    cs.kind === "local" &&
    Array.isArray(b.files) &&
    b.files.length > 0 &&
    b.files.every(isFileEntry)
  );
}

// `collab share` and `GET /sites/:slug`. M3: multi-page Sites with blob
// negotiation. M6: re-upload → new Version (`POST /sites/:slug/versions`) +
// per-Version permalinks (`GET /sites/:slug?v=<ordinal>`).
export function sitesRoutes(getDeps: () => AppDeps) {
  const app = new Hono();

  // Create a Site from a pre-uploaded manifest. The client must have already
  // PUT all blob hashes via /blobs before calling this.
  app.post("/sites", async (c) => {
    const body = (await c.req.json().catch(() => null)) as unknown;
    if (!validBody(body)) {
      return c.json(
        { error: "expected JSON { contentSource: {kind:'local'}, files: [{path,kind,contentHash},...] }" },
        400,
      );
    }

    const { db, store, viewerUrl, limits } = getDeps();

    const missing = await missingBlobs(store, body.files);
    if (missing.length > 0) {
      return c.json({ error: "blobs missing; upload them first", missing }, 409);
    }

    // Operator upload caps (M9) — all default-unset (infinite retention).
    const violation = await checkUploadLimits(store, body.files, limits);
    if (violation) return c.json({ error: violation.error }, 413);

    const pages = await buildManifestPages(store, body.files);

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

  // Re-upload: append a new Version to an existing Site (owner-authed, PLAN §4).
  // Full-Site upload (no partial updates, CONTEXT "Version"); after the new
  // Version becomes Latest, migrate every Conversation's anchor forward.
  app.post("/sites/:slug/versions", async (c) => {
    const deps = getDeps();
    const slug = c.req.param("slug");

    const auth = await authorizeOwner(c, deps, slug);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);

    const body = (await c.req.json().catch(() => null)) as unknown;
    if (!validBody(body)) {
      return c.json(
        { error: "expected JSON { contentSource: {kind:'local'}, files: [{path,kind,contentHash},...] }" },
        400,
      );
    }

    const missing = await missingBlobs(deps.store, body.files);
    if (missing.length > 0) {
      return c.json({ error: "blobs missing; upload them first", missing }, 409);
    }

    const violation = await checkUploadLimits(deps.store, body.files, deps.limits);
    if (violation) return c.json({ error: violation.error }, 413);

    const pages = await buildManifestPages(deps.store, body.files);
    const { ordinal } = await addVersionWithManifest(deps.db, {
      siteId: auth.site.id,
      contentSource: { kind: "local" },
      provenance: body.provenance ?? null,
      pages,
    });

    const report = await migrateConversationsToLatest(deps, slug, auth.site.id);

    const entryPath = pickEntryPath(body.files);
    return c.json(
      {
        slug,
        shareUrl: `${deps.viewerUrl}/s/${slug}`,
        version: ordinal,
        entryPath,
        migration: report,
      },
      201,
    );
  });

  // Site metadata: Nav tree, entry path, content base URL, and the full page list.
  // `?v=<ordinal>` pins a historical Version (read-only permalink, CONTEXT
  // "Latest"); absent = Latest. Always reports `latestVersion` + `isLatest` so the
  // viewer can show a "not latest" banner.
  app.get("/sites/:slug", async (c) => {
    const deps = getDeps();
    const slug = c.req.param("slug");

    const vParam = c.req.query("v");
    const pinned = vParam !== undefined ? Number(vParam) : undefined;
    if (pinned !== undefined && (!Number.isInteger(pinned) || pinned < 1)) {
      return c.json({ error: "invalid version" }, 400);
    }

    const latest = await getLatestManifest(deps.db, slug);
    if (!latest) return c.json({ error: "not found" }, 404);

    const manifest =
      pinned !== undefined && pinned !== latest.ordinal
        ? await getManifestByOrdinal(deps.db, slug, pinned)
        : latest;
    if (!manifest) return c.json({ error: "version not found" }, 404);

    const { site, ordinal, pages } = manifest;
    const entryPath = pickEntryPath(pages);
    const isLatest = ordinal === latest.ordinal;
    return c.json({
      slug: site.slug,
      state: site.state,
      version: ordinal,
      latestVersion: latest.ordinal,
      isLatest,
      entryPath,
      contentBase: isLatest
        ? contentBaseFor(site.slug, deps)
        : `${contentBaseFor(site.slug, deps)}/v/${ordinal}`,
      nav: buildNav(pages),
      pages: pages.map((p) => ({ path: p.path, kind: p.kind, title: p.title ?? p.path })),
    });
  });

  // ---- M9: Owner moderation & ops (CONTEXT "Owner"/"Site state") ----
  // Every route below is owner-authed via the header owner token (never `?token=`
  // — these are management actions, distinct from the read/agent surface).

  const VALID_STATES = new Set(["open", "read_only", "frozen"]);

  // PATCH /sites/:slug/state — set the Site state (CONTEXT "Site state").
  app.patch("/sites/:slug/state", async (c) => {
    const deps = getDeps();
    const slug = c.req.param("slug");
    const auth = await authorizeOwner(c, deps, slug);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);

    const body = (await c.req.json().catch(() => null)) as { state?: unknown } | null;
    const state = body?.state;
    if (typeof state !== "string" || !VALID_STATES.has(state)) {
      return c.json({ error: "expected JSON { state: 'open' | 'read_only' | 'frozen' }" }, 400);
    }

    await setSiteState(deps.db, auth.site.id, state as "open" | "read_only" | "frozen");
    return c.json({ slug, state }, 200);
  });

  // DELETE /sites/:slug — owner-delete the entire Site (cascades all metadata).
  app.delete("/sites/:slug", async (c) => {
    const deps = getDeps();
    const slug = c.req.param("slug");
    const auth = await authorizeOwner(c, deps, slug);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);

    await deleteSite(deps.db, auth.site.id);
    return new Response(null, { status: 204 });
  });

  // POST /sites/:slug/rotate-share — mint a fresh Share URL slug (kills a leaked
  // link). Returns the new slug + Share URL; the owner token is unchanged.
  app.post("/sites/:slug/rotate-share", async (c) => {
    const deps = getDeps();
    const slug = c.req.param("slug");
    const auth = await authorizeOwner(c, deps, slug);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);

    const newSlug = randomSlug();
    await rotateSlug(deps.db, { siteId: auth.site.id, newSlug });
    return c.json({ slug: newSlug, shareUrl: `${deps.viewerUrl}/s/${newSlug}` }, 200);
  });

  // POST /sites/:slug/rotate-token — mint a fresh owner token and revoke all prior
  // owner tokens (rotation = new token, revoke old; invalidates leaked Agent URLs).
  // The presenting token authorized this request before it was revoked.
  app.post("/sites/:slug/rotate-token", async (c) => {
    const deps = getDeps();
    const slug = c.req.param("slug");
    const auth = await authorizeOwner(c, deps, slug);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);

    const token = mintToken();
    await rotateOwnerToken(deps.db, { siteId: auth.site.id, newTokenHash: hashToken(token) });
    return c.json({ token, agentUrl: `${deps.viewerUrl}/s/${slug}?token=${token}` }, 200);
  });

  // GET /sites/:slug/tokens — list this Site's tokens (metadata only, never the
  // secret) so the owner can pick one to revoke.
  app.get("/sites/:slug/tokens", async (c) => {
    const deps = getDeps();
    const slug = c.req.param("slug");
    const auth = await authorizeOwner(c, deps, slug);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);

    const tokens = await listTokens(deps.db, auth.site.id);
    return c.json({ tokens }, 200);
  });

  // DELETE /sites/:slug/tokens/:id — revoke a single token (e.g. a leaked viewer
  // token). Refuses to revoke the last live owner token (would lock the owner out
  // — use rotate-token to replace it).
  app.delete("/sites/:slug/tokens/:id", async (c) => {
    const deps = getDeps();
    const slug = c.req.param("slug");
    const auth = await authorizeOwner(c, deps, slug);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);

    const result = await revokeToken(deps.db, {
      tokenId: c.req.param("id"),
      siteId: auth.site.id,
    });
    if (!result.ok) {
      if (result.reason === "not_found") return c.json({ error: "not found" }, 404);
      return c.json(
        { error: "cannot revoke the last owner token — rotate it instead" },
        409,
      );
    }
    return new Response(null, { status: 204 });
  });

  return app;
}

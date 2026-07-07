import { Hono } from "hono";
import { diffLines } from "@collab/core";
import {
  getLatestVersionId,
  getManifestByOrdinal,
  getSiteBySlug,
  listVersions,
  setLastSeen,
  summaryForViewer,
  type PageEntry,
} from "@collab/db";
import type { AppDeps } from "../config.js";

const decoder = new TextDecoder();

// M6 — Versioning UX read APIs: Version list, source-level Diff (default Last
// Seen vs Latest), Last Seen tracking, and "new since" summary counts. Write
// (re-upload → new Version) lives in sites.ts; these are read/tracking only and
// need no owner token (they're viewer-facing, gated by the Share URL like the
// rest of the read surface, ADR-0001).
export function versionsRoutes(getDeps: () => AppDeps) {
  const app = new Hono();

  // GET /sites/:slug/versions — every Version, newest first (CONTEXT "Version").
  app.get("/sites/:slug/versions", async (c) => {
    const { db } = getDeps();
    const site = await getSiteBySlug(db, c.req.param("slug"));
    if (!site) return c.json({ error: "not found" }, 404);
    const versions = await listVersions(db, site.id);
    return c.json({ versions }, 200);
  });

  // GET /sites/:slug/diff?from=<ord>&to=<ord>[&path=<pagePath>]
  //  - without `path`: the changed-Pages summary between the two Versions.
  //  - with `path`: the source-level line diff for that one Page.
  // `to` defaults to Latest.
  app.get("/sites/:slug/diff", async (c) => {
    const deps = getDeps();
    const slug = c.req.param("slug");
    const site = await getSiteBySlug(deps.db, slug);
    if (!site) return c.json({ error: "not found" }, 404);

    const latest = await getLatestVersionId(deps.db, site.id);
    if (!latest) return c.json({ error: "site has no versions" }, 400);

    const toOrd = c.req.query("to") !== undefined ? Number(c.req.query("to")) : latest.ordinal;
    const fromParam = c.req.query("from");
    const fromOrd = fromParam !== undefined ? Number(fromParam) : NaN;

    if (!Number.isInteger(fromOrd) || fromOrd < 1 || !Number.isInteger(toOrd) || toOrd < 1) {
      return c.json({ error: "from and to must be positive version ordinals" }, 400);
    }

    const [fromManifest, toManifest] = await Promise.all([
      getManifestByOrdinal(deps.db, slug, fromOrd),
      getManifestByOrdinal(deps.db, slug, toOrd),
    ]);
    if (!fromManifest || !toManifest) return c.json({ error: "version not found" }, 404);

    const path = c.req.query("path");
    if (path) {
      const fromPage = fromManifest.pages.find((p) => p.path === path);
      const toPage = toManifest.pages.find((p) => p.path === path);
      const status = pageStatus(fromPage, toPage);
      const oldSrc = await sourceOf(deps, fromPage);
      const newSrc = await sourceOf(deps, toPage);
      const diff = diffLines(oldSrc, newSrc);
      return c.json({ from: fromOrd, to: toOrd, path, status, diff }, 200);
    }

    // Changed-Pages summary: union of paths across both Versions, status by hash.
    const paths = new Set<string>([
      ...fromManifest.pages.map((p) => p.path),
      ...toManifest.pages.map((p) => p.path),
    ]);
    const byPathFrom = new Map(fromManifest.pages.map((p) => [p.path, p]));
    const byPathTo = new Map(toManifest.pages.map((p) => [p.path, p]));

    const pages = [...paths]
      .sort()
      .map((p) => {
        const f = byPathFrom.get(p);
        const t = byPathTo.get(p);
        return {
          path: p,
          kind: (t ?? f)!.kind,
          status: pageStatus(f, t),
        };
      })
      .filter((p) => p.status !== "unchanged");

    return c.json({ from: fromOrd, to: toOrd, pages }, 200);
  });

  // PUT /sites/:slug/last-seen — record a Viewer's Last Seen Version. Body:
  // { viewerId, version? } (version defaults to Latest). CONTEXT "Last Seen".
  app.put("/sites/:slug/last-seen", async (c) => {
    const { db } = getDeps();
    const slug = c.req.param("slug");
    const site = await getSiteBySlug(db, slug);
    if (!site) return c.json({ error: "not found" }, 404);

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.viewerId !== "string") {
      return c.json({ error: "expected JSON { viewerId, version? }" }, 400);
    }

    const latest = await getLatestVersionId(db, site.id);
    if (!latest) return c.json({ error: "site has no versions" }, 400);

    // Resolve the target Version id (given ordinal or Latest).
    let versionId = latest.id;
    if (typeof body.version === "number") {
      const manifest = await getManifestByOrdinal(db, slug, body.version);
      if (!manifest) return c.json({ error: "version not found" }, 404);
      versionId = manifest.pages[0]?.versionId ?? latest.id;
    }

    await setLastSeen(db, { viewerId: body.viewerId, siteId: site.id, versionId });
    return c.json({ ok: true }, 200);
  });

  // GET /sites/:slug/summary?viewerId=<id> — "new since last visit" counts.
  app.get("/sites/:slug/summary", async (c) => {
    const { db } = getDeps();
    const slug = c.req.param("slug");
    const site = await getSiteBySlug(db, slug);
    if (!site) return c.json({ error: "not found" }, 404);

    const viewerId = c.req.query("viewerId") ?? null;
    const summary = await summaryForViewer(db, { siteId: site.id, viewerId });
    return c.json(summary, 200);
  });

  return app;
}

type PageChange = "added" | "removed" | "modified" | "unchanged";

function pageStatus(from: PageEntry | undefined, to: PageEntry | undefined): PageChange {
  if (!from && to) return "added";
  if (from && !to) return "removed";
  if (from && to) return from.contentHash === to.contentHash ? "unchanged" : "modified";
  return "unchanged";
}

// Read a Page's canonical source text (empty string when the Page is absent on
// that side, so an add/remove diffs cleanly against nothing).
async function sourceOf(deps: AppDeps, page: PageEntry | undefined): Promise<string> {
  if (!page) return "";
  const bytes = await deps.store.get(page.contentHash);
  return bytes ? decoder.decode(bytes) : "";
}

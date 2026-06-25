// Repository helpers over the Drizzle client. The server is the only caller
// (PLAN §1: server is the only place HTTP + db meet). These keep route handlers
// free of query plumbing and own the multi-row invariants of an upload
// (site + owner token + first Version + manifest, in one transaction).
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "./client.js";
import {
  manifestEntries,
  siteTokens,
  sites,
  versions,
  type ContentSource,
  type Provenance,
} from "./schema.js";

export interface NewPage {
  path: string;
  kind: "markdown" | "html" | "asset";
  contentHash: string;
  title?: string | null;
  renderedHash?: string | null;
  sourceMapHash?: string | null;
}

export interface CreateSiteInput {
  slug: string;
  /** Hashed owner capability token (PLAN §4 — tokens stored hashed). */
  ownerTokenHash: string;
  ownerTokenLabel?: string | null;
  contentSource: ContentSource;
  provenance?: Provenance | null;
  pages: NewPage[];
}

export interface CreatedSite {
  siteId: string;
  versionId: string;
  ordinal: number;
}

// Create a Site, its owner token, the first Version (ordinal 1, Latest), and the
// Version's manifest — atomically. The slug and token hash are minted by the
// caller (server/tokens).
export async function createSiteWithVersion(
  db: Db,
  input: CreateSiteInput,
): Promise<CreatedSite> {
  return db.transaction(async (tx) => {
    const [site] = await tx.insert(sites).values({ slug: input.slug }).returning();
    await tx.insert(siteTokens).values({
      siteId: site!.id,
      kind: "owner",
      label: input.ownerTokenLabel ?? null,
      tokenHash: input.ownerTokenHash,
    });
    const [version] = await tx
      .insert(versions)
      .values({
        siteId: site!.id,
        ordinal: 1,
        contentSource: input.contentSource,
        provenance: input.provenance ?? null,
        isLatest: true,
      })
      .returning();
    if (input.pages.length > 0) {
      await tx.insert(manifestEntries).values(
        input.pages.map((p) => ({
          versionId: version!.id,
          path: p.path,
          kind: p.kind,
          contentHash: p.contentHash,
          title: p.title ?? null,
          renderedHash: p.renderedHash ?? null,
          sourceMapHash: p.sourceMapHash ?? null,
        })),
      );
    }
    return { siteId: site!.id, versionId: version!.id, ordinal: version!.ordinal };
  });
}

export interface SiteRow {
  id: string;
  slug: string;
  state: "open" | "read_only" | "frozen";
}

export interface PageEntry {
  versionId: string;
  ordinal: number;
  path: string;
  kind: "markdown" | "html" | "asset";
  contentHash: string;
  title: string | null;
  renderedHash: string | null;
  sourceMapHash: string | null;
}

export interface SitePage {
  site: SiteRow;
  page: PageEntry;
}

export async function getSiteBySlug(db: Db, slug: string): Promise<SiteRow | null> {
  const [row] = await db
    .select({ id: sites.id, slug: sites.slug, state: sites.state })
    .from(sites)
    .where(eq(sites.slug, slug))
    .limit(1);
  return row ?? null;
}

// Entry Page precedence (CONTEXT "Entry Page"). M2 hosts a single Page, but the
// same rule decides which Page the Share URL root resolves to.
const ENTRY_PRECEDENCE = ["index.html", "index.md", "README.md"];

function pickEntry(pages: PageEntry[]): PageEntry | undefined {
  for (const name of ENTRY_PRECEDENCE) {
    const hit = pages.find((p) => p.path === name);
    if (hit) return hit;
  }
  return pages[0];
}

// Resolve a Page of the Latest Version of a Site. With no `path`, returns the
// Entry Page. The full multi-Page Nav arrives in M3.
export async function getLatestPage(
  db: Db,
  slug: string,
  path?: string,
): Promise<SitePage | null> {
  const site = await getSiteBySlug(db, slug);
  if (!site) return null;

  const [latest] = await db
    .select({ id: versions.id, ordinal: versions.ordinal })
    .from(versions)
    .where(and(eq(versions.siteId, site.id), eq(versions.isLatest, true)))
    .limit(1);
  if (!latest) return null;

  const rows = await db
    .select()
    .from(manifestEntries)
    .where(eq(manifestEntries.versionId, latest.id))
    .orderBy(asc(manifestEntries.path));

  const pages: PageEntry[] = rows.map((r) => ({
    versionId: r.versionId,
    ordinal: latest.ordinal,
    path: r.path,
    kind: r.kind,
    contentHash: r.contentHash,
    title: r.title,
    renderedHash: r.renderedHash,
    sourceMapHash: r.sourceMapHash,
  }));

  const page = path ? pages.find((p) => p.path === path) : pickEntry(pages);
  if (!page) return null;
  return { site, page };
}

export interface SiteManifest {
  site: SiteRow;
  ordinal: number;
  pages: PageEntry[];
}

// All manifest entries (markdown + asset) for the Latest Version, ordered by
// path. Used for Site metadata, Nav, and content routing in M3+.
export async function getLatestManifest(
  db: Db,
  slug: string,
): Promise<SiteManifest | null> {
  const site = await getSiteBySlug(db, slug);
  if (!site) return null;

  const [latest] = await db
    .select({ id: versions.id, ordinal: versions.ordinal })
    .from(versions)
    .where(and(eq(versions.siteId, site.id), eq(versions.isLatest, true)))
    .limit(1);
  if (!latest) return null;

  const rows = await db
    .select()
    .from(manifestEntries)
    .where(eq(manifestEntries.versionId, latest.id))
    .orderBy(asc(manifestEntries.path));

  const pages: PageEntry[] = rows.map((r) => ({
    versionId: r.versionId,
    ordinal: latest.ordinal,
    path: r.path,
    kind: r.kind,
    contentHash: r.contentHash,
    title: r.title,
    renderedHash: r.renderedHash,
    sourceMapHash: r.sourceMapHash,
  }));

  return { site, ordinal: latest.ordinal, pages };
}

// Repository helpers over the Drizzle client. The server is the only caller
// (PLAN §1: server is the only place HTTP + db meet). These keep route handlers
// free of query plumbing and own the multi-row invariants of an upload
// (site + owner token + first Version + manifest, in one transaction).
import { and, asc, desc, eq, gt, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { Db } from "./client.js";

// A Drizzle handle that is either the root client or an open transaction — lets a
// helper run inside a caller's transaction without a `$client` type mismatch.
type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
import {
  comments,
  conversations,
  manifestEntries,
  mentions,
  reactions,
  siteTokens,
  sites,
  versions,
  viewers,
  viewerState,
  type Anchor,
  type ContentSource,
  type Identity,
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

// ---- M6: Versioning ----

// Load one Version's manifest by ordinal (a per-Version permalink, CONTEXT
// "Latest"). Read-only historical content view in the viewer.
export async function getManifestByOrdinal(
  db: Db,
  slug: string,
  ordinal: number,
): Promise<SiteManifest | null> {
  const site = await getSiteBySlug(db, slug);
  if (!site) return null;

  const [version] = await db
    .select({ id: versions.id, ordinal: versions.ordinal })
    .from(versions)
    .where(and(eq(versions.siteId, site.id), eq(versions.ordinal, ordinal)))
    .limit(1);
  if (!version) return null;

  const rows = await db
    .select()
    .from(manifestEntries)
    .where(eq(manifestEntries.versionId, version.id))
    .orderBy(asc(manifestEntries.path));

  const pages: PageEntry[] = rows.map((r) => ({
    versionId: r.versionId,
    ordinal: version.ordinal,
    path: r.path,
    kind: r.kind,
    contentHash: r.contentHash,
    title: r.title,
    renderedHash: r.renderedHash,
    sourceMapHash: r.sourceMapHash,
  }));

  return { site, ordinal: version.ordinal, pages };
}

export interface VersionSummary {
  ordinal: number;
  createdAt: string;
  provenance: Provenance | null;
  isLatest: boolean;
}

// All Versions of a Site, newest first (CONTEXT "Version"). Powers `list_versions`
// and the viewer's Version picker / Diff baseline selection.
export async function listVersions(db: Db, siteId: string): Promise<VersionSummary[]> {
  const rows = await db
    .select({
      ordinal: versions.ordinal,
      createdAt: versions.createdAt,
      provenance: versions.provenance,
      isLatest: versions.isLatest,
    })
    .from(versions)
    .where(eq(versions.siteId, siteId))
    .orderBy(desc(versions.ordinal));
  return rows.map((r) => ({
    ordinal: r.ordinal,
    createdAt: r.createdAt.toISOString(),
    provenance: (r.provenance as Provenance | null) ?? null,
    isLatest: r.isLatest,
  }));
}

// Verify an owner capability token (presented hashed) is valid for a Site: a live
// (non-revoked) owner-kind token row. Gates re-upload + owner actions (PLAN §4).
export async function verifyOwnerToken(
  db: Db,
  siteId: string,
  tokenHash: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: siteTokens.id })
    .from(siteTokens)
    .where(
      and(
        eq(siteTokens.siteId, siteId),
        eq(siteTokens.kind, "owner"),
        eq(siteTokens.tokenHash, tokenHash),
        isNull(siteTokens.revokedAt),
      ),
    )
    .limit(1);
  return row !== undefined;
}

// ---- M8: Viewer-scoped agent tokens (ADR-0006 tier 2) ----

// Mint a Viewer-scoped agent token: revoke any live token the Viewer already
// holds (one live token per Viewer — re-minting rotates), then insert the new
// hashed row. Possession of the unguessable viewerId is the authorization to
// mint (the route checks the Viewer exists on the Site first).
export async function mintViewerToken(
  db: Db,
  input: { siteId: string; viewerId: string; tokenHash: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(siteTokens)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          eq(siteTokens.viewerId, input.viewerId),
          eq(siteTokens.kind, "viewer"),
          isNull(siteTokens.revokedAt),
        ),
      );
    await tx.insert(siteTokens).values({
      siteId: input.siteId,
      kind: "viewer",
      viewerId: input.viewerId,
      tokenHash: input.tokenHash,
    });
  });
}

// Resolve a live Viewer-scoped agent token (presented hashed) to its owning
// Viewer + display name. Null when no live viewer-kind token matches. Gates the
// viewer-agent tier (ADR-0006): read the Site, read/post the Viewer's Chats,
// create/post public Threads.
export async function resolveViewerToken(
  db: Db,
  siteId: string,
  tokenHash: string,
): Promise<{ viewerId: string; displayName: string | null } | null> {
  const [row] = await db
    .select({ viewerId: viewers.id, displayName: viewers.displayName })
    .from(siteTokens)
    .innerJoin(viewers, eq(siteTokens.viewerId, viewers.id))
    .where(
      and(
        eq(siteTokens.siteId, siteId),
        eq(siteTokens.kind, "viewer"),
        eq(siteTokens.tokenHash, tokenHash),
        isNull(siteTokens.revokedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface AddVersionInput {
  siteId: string;
  contentSource: ContentSource;
  provenance?: Provenance | null;
  pages: NewPage[];
}

export interface AddedVersion {
  versionId: string;
  ordinal: number;
}

// Append a new Version to an existing Site: allocate the next ordinal, flip the
// old Latest off and the new one on, and write its manifest — atomically
// (CONTEXT "Version": re-uploading creates a new Version rather than overwriting).
export async function addVersionWithManifest(
  db: Db,
  input: AddVersionInput,
): Promise<AddedVersion> {
  return db.transaction(async (tx) => {
    const maxRows = await tx
      .select({ max: sql<number>`coalesce(max(${versions.ordinal}), 0)` })
      .from(versions)
      .where(eq(versions.siteId, input.siteId));
    const ordinal = Number(maxRows[0]?.max ?? 0) + 1;

    // Demote the current Latest.
    await tx
      .update(versions)
      .set({ isLatest: false })
      .where(and(eq(versions.siteId, input.siteId), eq(versions.isLatest, true)));

    const [version] = await tx
      .insert(versions)
      .values({
        siteId: input.siteId,
        ordinal,
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

    return { versionId: version!.id, ordinal };
  });
}

export interface MigrationCandidate {
  id: string;
  pagePath: string | null;
  anchor: Anchor | null;
  anchorStatus: "live" | "outdated";
}

// Every Conversation whose anchor status might change when a new Version lands:
// all public Conversations on a Site (anchored and page-level). The server reads
// each page's new rendered text and re-resolves the text-quote (core.migrateAnchor).
export async function listConversationsForMigration(
  db: Db,
  siteId: string,
): Promise<MigrationCandidate[]> {
  const rows = await db
    .select({
      id: conversations.id,
      pagePath: conversations.pagePath,
      anchor: conversations.anchor,
      anchorStatus: conversations.anchorStatus,
    })
    .from(conversations)
    .where(eq(conversations.siteId, siteId));
  return rows.map((r) => ({
    id: r.id,
    pagePath: r.pagePath,
    anchor: (r.anchor as Anchor | null) ?? null,
    anchorStatus: r.anchorStatus as "live" | "outdated",
  }));
}

// Persist a Conversation's post-migration anchor state.
export async function updateAnchorAfterMigration(
  db: Db,
  input: { id: string; anchorStatus: "live" | "outdated"; anchor: Anchor | null },
): Promise<void> {
  await db
    .update(conversations)
    .set({ anchorStatus: input.anchorStatus, anchor: input.anchor })
    .where(eq(conversations.id, input.id));
}

// ---- M6: Last Seen + summary counts ----

// The Version a Viewer most recently looked at (CONTEXT "Last Seen Version") — the
// Diff baseline and "new since" anchor. Null when the Viewer hasn't been recorded.
export async function getLastSeenOrdinal(
  db: Db,
  viewerId: string,
  siteId: string,
): Promise<number | null> {
  const [row] = await db
    .select({ ordinal: versions.ordinal })
    .from(viewerState)
    .innerJoin(versions, eq(viewerState.lastSeenVersionId, versions.id))
    .where(and(eq(viewerState.viewerId, viewerId), eq(viewerState.siteId, siteId)))
    .limit(1);
  return row?.ordinal ?? null;
}

// Upsert a Viewer's Last Seen Version (client-tracked, recorded server-side so
// summary counts survive across devices for a durable Viewer).
export async function setLastSeen(
  db: Db,
  input: { viewerId: string; siteId: string; versionId: string },
): Promise<void> {
  await db
    .insert(viewerState)
    .values({
      viewerId: input.viewerId,
      siteId: input.siteId,
      lastSeenVersionId: input.versionId,
    })
    .onConflictDoUpdate({
      target: [viewerState.viewerId, viewerState.siteId],
      set: { lastSeenVersionId: input.versionId },
    });
}

export interface ViewerSummary {
  latestVersion: number;
  lastSeenVersion: number | null;
  /** Versions newer than Last Seen (0 when caught up or never seen). */
  newVersions: number;
  /** Comments authored on Versions newer than Last Seen, excluding the Viewer's own. */
  newComments: number;
}

// "New since last visit" counts for a Viewer (CONTEXT "Last Seen Version"). New
// versions = ordinals above lastSeen; new comments = comments bound to those
// versions, excluding the Viewer's own and deleted tombstones.
export async function summaryForViewer(
  db: Db,
  input: { siteId: string; viewerId: string | null },
): Promise<ViewerSummary> {
  const latest = await getLatestVersionId(db, input.siteId);
  const latestVersion = latest?.ordinal ?? 0;

  const lastSeenVersion = input.viewerId
    ? await getLastSeenOrdinal(db, input.viewerId, input.siteId)
    : null;

  if (lastSeenVersion === null || lastSeenVersion >= latestVersion) {
    return { latestVersion, lastSeenVersion, newVersions: 0, newComments: 0 };
  }

  const newVersions = latestVersion - lastSeenVersion;

  // Comments on versions with ordinal > lastSeen, excluding own + deleted.
  const countRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(comments)
    .innerJoin(versions, eq(comments.versionId, versions.id))
    .where(
      and(
        eq(versions.siteId, input.siteId),
        gt(versions.ordinal, lastSeenVersion),
        isNull(comments.deletedAt),
        isNull(comments.hiddenAt),
        input.viewerId
          ? sql`(${comments.authorViewerId} is distinct from ${input.viewerId})`
          : sql`true`,
      ),
    );

  return {
    latestVersion,
    lastSeenVersion,
    newVersions,
    newComments: Number(countRows[0]?.count ?? 0),
  };
}

// ---- M5: Viewers, Conversations, Comments, Reactions ----

// Mint a new anonymous Viewer for a Site. The caller (server) persists the id
// in the client's localStorage (CONTEXT "Viewer").
export async function mintViewer(db: Db, siteId: string): Promise<{ viewerId: string }> {
  const [row] = await db
    .insert(viewers)
    .values({ siteId })
    .returning({ viewerId: viewers.id });
  return { viewerId: row!.viewerId };
}

// Load a Viewer scoped to a Site (M8): confirms the viewerId belongs to the Site
// and returns its display name (for identity building / agent-token minting).
// Null when no such Viewer exists on the Site.
export async function getViewer(
  db: Db,
  viewerId: string,
  siteId: string,
): Promise<{ id: string; displayName: string | null } | null> {
  const [row] = await db
    .select({ id: viewers.id, displayName: viewers.displayName })
    .from(viewers)
    .where(and(eq(viewers.id, viewerId), eq(viewers.siteId, siteId)))
    .limit(1);
  return row ?? null;
}

// Return the id + ordinal of the Latest Version for a Site, or null if none.
export async function getLatestVersionId(
  db: Db,
  siteId: string,
): Promise<{ id: string; ordinal: number } | null> {
  const [row] = await db
    .select({ id: versions.id, ordinal: versions.ordinal })
    .from(versions)
    .where(and(eq(versions.siteId, siteId), eq(versions.isLatest, true)))
    .limit(1);
  return row ?? null;
}

export interface CreateConversationInput {
  siteId: string;
  createdVersionId: string;
  pagePath: string | null;
  /** Public = Thread, private = Chat (CONTEXT "Conversation"/"Chat"/"Thread"). */
  visibility: "public" | "private";
  anchor: Anchor | null;
  /** The owning Viewer for a private Chat (M8, ADR-0006); null for a Thread. */
  ownerViewerId?: string | null;
  // First comment fields
  firstComment: {
    versionId: string;
    body: string;
    author: Identity;
    authorViewerId: string | null;
    /** @-mention targets parsed from the body (M7, CONTEXT "Mention"). */
    mentions?: string[];
  };
}

// Create a Conversation and its first Comment in one transaction. Returns the
// new conversation id.
export async function createConversation(
  db: Db,
  input: CreateConversationInput,
): Promise<{ conversationId: string }> {
  return db.transaction(async (tx) => {
    const [conv] = await tx
      .insert(conversations)
      .values({
        siteId: input.siteId,
        createdVersionId: input.createdVersionId,
        pagePath: input.pagePath,
        visibility: input.visibility,
        anchor: input.anchor ?? null,
        ownerViewerId: input.ownerViewerId ?? null,
      })
      .returning({ id: conversations.id });

    const [firstComment] = await tx
      .insert(comments)
      .values({
        conversationId: conv!.id,
        versionId: input.firstComment.versionId,
        body: input.firstComment.body,
        author: input.firstComment.author,
        authorViewerId: input.firstComment.authorViewerId ?? null,
      })
      .returning({ id: comments.id });

    await insertMentions(tx, firstComment!.id, input.firstComment.mentions);
    await persistViewerDisplayName(
      tx,
      input.firstComment.author,
      input.firstComment.authorViewerId ?? null,
    );

    return { conversationId: conv!.id };
  });
}

// Persist a human Viewer's display name onto its `viewers` row (CONTEXT "Viewer":
// the name is "supplied on first comment"). It lives on each Comment's author JSON
// too, but the canonical row is what a Viewer-scoped agent token resolves to when
// Collab labels that agent "Reviewer <name>'s agent" (M8, ADR-0006). Only human
// viewer authors carry a name here; agent authors have authorViewerId=null. Runs
// inside the caller's transaction. Latest supplied name wins (reflects renames).
async function persistViewerDisplayName(
  tx: DbOrTx,
  author: Identity,
  authorViewerId: string | null,
): Promise<void> {
  if (author.kind !== "human" || !authorViewerId) return;
  const name = author.name.trim();
  if (name === "") return;
  await tx.update(viewers).set({ displayName: name }).where(eq(viewers.id, authorViewerId));
}

// Persist the @-mention targets parsed from a comment body (M7). No-op for an
// empty list. Called inside the same transaction as the comment insert.
async function insertMentions(
  tx: DbOrTx,
  commentId: string,
  targets: string[] | undefined,
): Promise<void> {
  if (!targets || targets.length === 0) return;
  await tx
    .insert(mentions)
    .values(targets.map((targetIdentity) => ({ commentId, targetIdentity })));
}

export interface AddCommentInput {
  conversationId: string;
  versionId: string;
  body: string;
  author: Identity;
  authorViewerId: string | null;
  /** @-mention targets parsed from the body (M7, CONTEXT "Mention"). */
  mentions?: string[];
}

// Add a reply comment to an existing Conversation. Returns the new comment id.
export async function addComment(
  db: Db,
  input: AddCommentInput,
): Promise<{ commentId: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(comments)
      .values({
        conversationId: input.conversationId,
        versionId: input.versionId,
        body: input.body,
        author: input.author,
        authorViewerId: input.authorViewerId ?? null,
      })
      .returning({ commentId: comments.id });
    await insertMentions(tx, row!.commentId, input.mentions);
    await persistViewerDisplayName(tx, input.author, input.authorViewerId ?? null);
    return { commentId: row!.commentId };
  });
}

// Owner-delete: tombstone ANY comment on the Site, regardless of author (M7 —
// agents act at the Owner tier, CONTEXT "Owner"). Verifies the comment belongs to
// the Site via its Conversation. Returns false when no such live comment exists.
export async function ownerDeleteComment(
  db: Db,
  input: { commentId: string; siteId: string },
): Promise<boolean> {
  // Resolve the comment's Conversation and confirm site ownership.
  const [row] = await db
    .select({ siteId: conversations.siteId })
    .from(comments)
    .innerJoin(conversations, eq(comments.conversationId, conversations.id))
    .where(and(eq(comments.id, input.commentId), isNull(comments.deletedAt)))
    .limit(1);
  if (!row || row.siteId !== input.siteId) return false;

  const result = await db
    .update(comments)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(comments.id, input.commentId), isNull(comments.deletedAt)))
    .returning({ id: comments.id });
  return result.length > 0;
}

// Edit a comment's body, setting editedAt to now. ONLY if authorViewerId ===
// viewerId and the comment is not deleted. Returns false when the caller is not
// the author (server turns this into a 403).
export async function editComment(
  db: Db,
  input: { commentId: string; viewerId: string; body: string },
): Promise<boolean> {
  const result = await db
    .update(comments)
    .set({ body: input.body, editedAt: sql`now()` })
    .where(
      and(
        eq(comments.id, input.commentId),
        eq(comments.authorViewerId, input.viewerId),
        isNull(comments.deletedAt),
      ),
    )
    .returning({ id: comments.id });
  return result.length > 0;
}

// Tombstone a comment (set deletedAt, keep the row). ONLY if authorViewerId ===
// viewerId. Returns false when the caller is not the author.
export async function deleteComment(
  db: Db,
  input: { commentId: string; viewerId: string },
): Promise<boolean> {
  const result = await db
    .update(comments)
    .set({ deletedAt: sql`now()` })
    .where(
      and(
        eq(comments.id, input.commentId),
        eq(comments.authorViewerId, input.viewerId),
        isNull(comments.deletedAt),
      ),
    )
    .returning({ id: comments.id });
  return result.length > 0;
}

// Resolve (resolvedAt=now, resolvedBy=name) or reopen (both null) a Conversation.
export async function setResolved(
  db: Db,
  input: { conversationId: string; resolved: boolean; resolvedBy: string },
): Promise<void> {
  await db
    .update(conversations)
    .set({
      resolvedAt: input.resolved ? sql`now()` : null,
      resolvedBy: input.resolved ? input.resolvedBy : null,
    })
    .where(eq(conversations.id, input.conversationId));
}

export interface ReactionGroup {
  emoji: string;
  count: number;
  mine: boolean;
}

// Toggle a reaction for a Viewer: delete if (commentId, emoji, authorViewerId)
// exists, otherwise insert. Returns the new grouped reactions for that comment.
export async function toggleReaction(
  db: Db,
  input: {
    commentId: string;
    emoji: string;
    viewerId: string;
    author: Identity;
  },
): Promise<ReactionGroup[]> {
  // Check if the viewer already reacted with this emoji.
  const existing = await db
    .select({ id: reactions.id })
    .from(reactions)
    .where(
      and(
        eq(reactions.commentId, input.commentId),
        eq(reactions.emoji, input.emoji),
        eq(reactions.authorViewerId, input.viewerId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db.delete(reactions).where(eq(reactions.id, existing[0]!.id));
  } else {
    await db.insert(reactions).values({
      commentId: input.commentId,
      emoji: input.emoji,
      author: input.author,
      authorViewerId: input.viewerId,
    });
  }

  return buildReactionGroups(db, input.commentId, input.viewerId);
}

async function buildReactionGroups(
  db: Db,
  commentId: string,
  viewerId: string | null,
): Promise<ReactionGroup[]> {
  const rows = await db
    .select({
      emoji: reactions.emoji,
      authorViewerId: reactions.authorViewerId,
    })
    .from(reactions)
    .where(eq(reactions.commentId, commentId));

  // Group by emoji, count, detect mine.
  const groups = new Map<string, { count: number; mine: boolean }>();
  for (const r of rows) {
    const g = groups.get(r.emoji) ?? { count: 0, mine: false };
    g.count += 1;
    if (viewerId && r.authorViewerId === viewerId) g.mine = true;
    groups.set(r.emoji, g);
  }
  return Array.from(groups.entries()).map(([emoji, g]) => ({
    emoji,
    count: g.count,
    mine: g.mine,
  }));
}

export interface CommentDTO {
  id: string;
  author: Identity;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  mine: boolean;
  reactions: ReactionGroup[];
}

export interface ConversationDTO {
  id: string;
  pagePath: string | null;
  anchor: Anchor | null;
  anchorStatus: "live" | "outdated";
  /** Ordinal of the Version this Conversation was created on (Outdated permalink). */
  createdOrdinal: number;
  resolved: boolean;
  resolvedBy: string | null;
  /** Private = Chat, public = Thread (CONTEXT "Conversation"). */
  visibility: "public" | "private";
  comments: CommentDTO[];
}

// A conversation row shape sufficient to assemble a ConversationDTO. Any query
// that selects `*` from `conversations` satisfies this.
interface ConversationRow {
  id: string;
  pagePath: string | null;
  anchor: unknown;
  anchorStatus: string;
  createdVersionId: string;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  visibility: string;
}

// Shared DTO assembly for Threads (listConversationsForPage) and Chats
// (listChats): given the conversation rows already loaded, fetch their
// (non-deleted, non-hidden) comments + reactions and build ConversationDTOs.
// Hidden comments (Promotion, M8) and the empty-body tombstone rendering are
// applied here so both listings behave identically.
async function assembleConversationDTOs(
  db: Db,
  convRows: ConversationRow[],
  viewerId: string | null,
): Promise<ConversationDTO[]> {
  if (convRows.length === 0) return [];

  const convIds = convRows.map((c) => c.id);

  // Map each conversation's createdVersionId → ordinal (Outdated permalink target).
  const createdVersionIds = [...new Set(convRows.map((c) => c.createdVersionId))];
  const versionRows = await db
    .select({ id: versions.id, ordinal: versions.ordinal })
    .from(versions)
    .where(inArray(versions.id, createdVersionIds));
  const ordinalByVersion = new Map(versionRows.map((v) => [v.id, v.ordinal]));

  // Comments for these conversations, excluding Promotion-hidden messages.
  const commentRows = await db
    .select()
    .from(comments)
    .where(and(inArray(comments.conversationId, convIds), isNull(comments.hiddenAt)))
    .orderBy(asc(comments.createdAt));

  const commentIds = commentRows.map((r) => r.id);

  const reactionRows =
    commentIds.length > 0
      ? await db.select().from(reactions).where(inArray(reactions.commentId, commentIds))
      : [];

  const reactionsByComment = new Map<string, ReactionGroup[]>();
  for (const commentId of commentIds) {
    const rs = reactionRows.filter((r) => r.commentId === commentId);
    const groups = new Map<string, { count: number; mine: boolean }>();
    for (const r of rs) {
      const g = groups.get(r.emoji) ?? { count: 0, mine: false };
      g.count += 1;
      if (viewerId && r.authorViewerId === viewerId) g.mine = true;
      groups.set(r.emoji, g);
    }
    reactionsByComment.set(
      commentId,
      Array.from(groups.entries()).map(([emoji, g]) => ({ emoji, count: g.count, mine: g.mine })),
    );
  }

  const commentsByConv = new Map<string, CommentDTO[]>();
  for (const c of commentRows) {
    const list = commentsByConv.get(c.conversationId) ?? [];
    const deleted = c.deletedAt !== null;
    list.push({
      id: c.id,
      author: c.author as Identity,
      body: deleted ? "" : c.body,
      createdAt: c.createdAt.toISOString(),
      editedAt: c.editedAt ? c.editedAt.toISOString() : null,
      deleted,
      mine: viewerId !== null && c.authorViewerId === viewerId,
      reactions: reactionsByComment.get(c.id) ?? [],
    });
    commentsByConv.set(c.conversationId, list);
  }

  return convRows.map((conv) => ({
    id: conv.id,
    pagePath: conv.pagePath,
    anchor: (conv.anchor as Anchor | null) ?? null,
    anchorStatus: conv.anchorStatus as "live" | "outdated",
    createdOrdinal: ordinalByVersion.get(conv.createdVersionId) ?? 0,
    resolved: conv.resolvedAt !== null,
    resolvedBy: conv.resolvedBy,
    visibility: conv.visibility as "public" | "private",
    comments: commentsByConv.get(conv.id) ?? [],
  }));
}

// List all public Conversations for a Site + page. pagePath=null selects
// page-level Threads (conversations.pagePath IS NULL). Assembles DTOs in JS with
// a few targeted queries (conversations → comments → reactions) rather than a
// single giant join.
export async function listConversationsForPage(
  db: Db,
  input: { siteId: string; pagePath: string | null; viewerId: string | null },
): Promise<ConversationDTO[]> {
  // Load public Conversations (Threads) for the page, then assemble DTOs with the
  // shared helper (also used by listChats for private Chats).
  const convRows = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.siteId, input.siteId),
        eq(conversations.visibility, "public"),
        input.pagePath !== null
          ? eq(conversations.pagePath, input.pagePath)
          : isNull(conversations.pagePath),
      ),
    )
    .orderBy(asc(conversations.id));

  return assembleConversationDTOs(db, convRows, input.viewerId);
}

// List a Viewer's private Chats (M8, ADR-0006 tier 2). Only Conversations the
// Viewer owns (ownerViewerId === viewerId) are ever returned — privacy is
// enforced by this predicate plus the token/viewerId check in the route. Mirrors
// listConversationsForPage's pagePath semantics: a string filters to that Page,
// null selects page-level Chats, and undefined returns Chats across all Pages
// (the polling `list_chats` feed). `since` (ISO) keeps only Chats with a Comment
// created strictly after that instant.
export async function listChats(
  db: Db,
  input: {
    siteId: string;
    viewerId: string;
    pagePath?: string | null;
    since?: string;
  },
): Promise<ConversationDTO[]> {
  const conds = [
    eq(conversations.siteId, input.siteId),
    eq(conversations.visibility, "private"),
    eq(conversations.ownerViewerId, input.viewerId),
  ];
  if (input.pagePath !== undefined) {
    conds.push(
      input.pagePath !== null
        ? eq(conversations.pagePath, input.pagePath)
        : isNull(conversations.pagePath),
    );
  }

  const convRows = await db
    .select()
    .from(conversations)
    .where(and(...conds))
    .orderBy(asc(conversations.id));

  const dtos = await assembleConversationDTOs(db, convRows, input.viewerId);

  if (!input.since) return dtos;
  const sinceMs = new Date(input.since).getTime();
  return dtos.filter((d) =>
    d.comments.some((cm) => new Date(cm.createdAt).getTime() > sinceMs),
  );
}

export interface ConversationMeta {
  id: string;
  visibility: "public" | "private";
  ownerViewerId: string | null;
}

// Load just the access-control fields of a Conversation on a Site (M8 guards).
// Null when no such Conversation exists for the Site.
export async function getConversationMeta(
  db: Db,
  id: string,
  siteId: string,
): Promise<ConversationMeta | null> {
  const [row] = await db
    .select({
      id: conversations.id,
      visibility: conversations.visibility,
      ownerViewerId: conversations.ownerViewerId,
    })
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.siteId, siteId)))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    visibility: row.visibility as "public" | "private",
    ownerViewerId: row.ownerViewerId,
  };
}

// Resolve a comment to its Conversation, confirming both belong to the Site.
// Used by the comment-id routes (edit/delete/react) to load the Conversation's
// M8 access meta. Null when the comment isn't on the Site.
export async function getCommentConversation(
  db: Db,
  commentId: string,
  siteId: string,
): Promise<{ conversationId: string } | null> {
  const [row] = await db
    .select({ conversationId: comments.conversationId })
    .from(comments)
    .innerJoin(conversations, eq(comments.conversationId, conversations.id))
    .where(and(eq(comments.id, commentId), eq(conversations.siteId, siteId)))
    .limit(1);
  return row ?? null;
}

export interface PromoteConversationInput {
  conversationId: string;
  /** Comment ids that stay visible; every other non-deleted comment is hidden. */
  keepCommentIds: string[];
  /** Optional summary prepended as a new visible comment. */
  summary?: string;
  summaryAuthor: Identity;
  summaryAuthorViewerId: string | null;
}

// Promote a Chat to a Thread (CONTEXT "Promotion"): flip the SAME Conversation
// private → public in place. Non-selected non-deleted Comments are hidden
// (hiddenAt=now, not tombstoned); the selected ones stay visible; anchor/resolve
// carry over untouched. An optional summary is prepended as a new visible Comment
// bound to the Conversation's latest Version. Verifies the Conversation is
// currently private (the route already checked the caller is the owning Viewer).
export async function promoteConversation(
  db: Db,
  input: PromoteConversationInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [conv] = await tx
      .select({ id: conversations.id, siteId: conversations.siteId, visibility: conversations.visibility })
      .from(conversations)
      .where(eq(conversations.id, input.conversationId))
      .limit(1);
    if (!conv || conv.visibility !== "private") {
      throw new Error("conversation is not a private Chat");
    }

    // Flip visibility public + drop private ownership.
    await tx
      .update(conversations)
      .set({ visibility: "public", ownerViewerId: null })
      .where(eq(conversations.id, input.conversationId));

    // Hide every non-selected, non-deleted comment.
    const keep = input.keepCommentIds;
    await tx
      .update(comments)
      .set({ hiddenAt: sql`now()` })
      .where(
        and(
          eq(comments.conversationId, input.conversationId),
          isNull(comments.deletedAt),
          isNull(comments.hiddenAt),
          keep.length > 0 ? notInArray(comments.id, keep) : undefined,
        ),
      );

    // Prepend an optional summary comment, bound to the latest Version the
    // Conversation has (newest existing comment's version, else site Latest).
    if (input.summary && input.summary.trim() !== "") {
      const [newest] = await tx
        .select({ versionId: comments.versionId })
        .from(comments)
        .where(eq(comments.conversationId, input.conversationId))
        .orderBy(desc(comments.createdAt))
        .limit(1);
      let versionId = newest?.versionId;
      if (!versionId) {
        const latest = await getLatestVersionId(tx as unknown as Db, conv.siteId);
        versionId = latest?.id;
      }
      if (versionId) {
        await tx.insert(comments).values({
          conversationId: input.conversationId,
          versionId,
          body: input.summary,
          author: input.summaryAuthor,
          authorViewerId: input.summaryAuthorViewerId ?? null,
        });
      }
    }
  });
}

// ---- M7: Agent surface — site-wide comment feed (`list_comments`) ----

// Normalize a mention target / identity name for case- and punctuation-insensitive
// matching. Mirrors `mentionsMatch` in @collab/core (kept local so @collab/db stays
// dependency-free); keep the two in sync. The possessive "'s" is dropped so the
// natural handle `@owner-agent` routes to the default "Owner's agent" label.
function normalizeMention(s: string): string {
  return s
    .toLowerCase()
    .replace(/['']s\b/g, "")
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface SiteCommentDTO {
  conversationId: string;
  commentId: string;
  pagePath: string | null;
  anchor: Anchor | null;
  anchorStatus: "live" | "outdated";
  resolved: boolean;
  /** Ordinal of the Version this comment was authored on. */
  version: number;
  /** Ordinal of the Version the Conversation was created on. */
  createdOrdinal: number;
  author: Identity;
  body: string;
  createdAt: string;
  editedAt: string | null;
  mentions: string[];
  reactions: Array<{ emoji: string; count: number }>;
}

export interface ListSiteCommentsFilter {
  siteId: string;
  /** Only comments in unresolved Conversations. */
  unresolved?: boolean;
  /** Only comments created strictly after this instant (ISO 8601). */
  since?: string;
  /** Only comments mentioning this identity (normalized match). */
  mentions?: string;
}

// The site-wide comment feed powering the agent `list_comments` verb (M7, PLAN §6).
// Flattens every public Thread's comments across all Pages, newest-relevant first
// ordering left to the caller — here we return oldest-first (createdAt, id) so the
// `after=<id>` cursor drops in later. Tombstoned comments are excluded. Each item
// carries its anchor (text-quote + source range), Page, Version, resolved state,
// and parsed mentions — everything an agent needs to ground a reply.
export async function listSiteComments(
  db: Db,
  filter: ListSiteCommentsFilter,
): Promise<SiteCommentDTO[]> {
  const conds = [
    eq(conversations.siteId, filter.siteId),
    eq(conversations.visibility, "public"),
    isNull(comments.deletedAt),
    isNull(comments.hiddenAt),
  ];
  if (filter.unresolved) conds.push(isNull(conversations.resolvedAt));
  if (filter.since) conds.push(gt(comments.createdAt, new Date(filter.since)));

  const rows = await db
    .select({
      commentId: comments.id,
      conversationId: comments.conversationId,
      author: comments.author,
      body: comments.body,
      createdAt: comments.createdAt,
      editedAt: comments.editedAt,
      versionOrdinal: versions.ordinal,
      pagePath: conversations.pagePath,
      anchor: conversations.anchor,
      anchorStatus: conversations.anchorStatus,
      resolvedAt: conversations.resolvedAt,
      createdVersionId: conversations.createdVersionId,
    })
    .from(comments)
    .innerJoin(conversations, eq(comments.conversationId, conversations.id))
    .innerJoin(versions, eq(comments.versionId, versions.id))
    .where(and(...conds))
    .orderBy(asc(comments.createdAt), asc(comments.id));

  if (rows.length === 0) return [];

  const commentIds = rows.map((r) => r.commentId);

  // Ordinal of each Conversation's creation Version (Outdated permalink target).
  const createdVersionIds = [...new Set(rows.map((r) => r.createdVersionId))];
  const versionRows = await db
    .select({ id: versions.id, ordinal: versions.ordinal })
    .from(versions)
    .where(inArray(versions.id, createdVersionIds));
  const ordinalByVersion = new Map(versionRows.map((v) => [v.id, v.ordinal]));

  // Mentions per comment.
  const mentionRows = await db
    .select({ commentId: mentions.commentId, target: mentions.targetIdentity })
    .from(mentions)
    .where(inArray(mentions.commentId, commentIds));
  const mentionsByComment = new Map<string, string[]>();
  for (const m of mentionRows) {
    const list = mentionsByComment.get(m.commentId) ?? [];
    list.push(m.target);
    mentionsByComment.set(m.commentId, list);
  }

  // Reaction counts per comment (agent feed omits per-viewer `mine`).
  const reactionRows = await db
    .select({ commentId: reactions.commentId, emoji: reactions.emoji })
    .from(reactions)
    .where(inArray(reactions.commentId, commentIds));
  const reactionsByComment = new Map<string, Map<string, number>>();
  for (const r of reactionRows) {
    const g = reactionsByComment.get(r.commentId) ?? new Map<string, number>();
    g.set(r.emoji, (g.get(r.emoji) ?? 0) + 1);
    reactionsByComment.set(r.commentId, g);
  }

  const wantMention = filter.mentions ? normalizeMention(filter.mentions) : null;

  const dtos: SiteCommentDTO[] = [];
  for (const r of rows) {
    const ments = mentionsByComment.get(r.commentId) ?? [];
    if (wantMention !== null && !ments.some((t) => normalizeMention(t) === wantMention)) {
      continue;
    }
    dtos.push({
      conversationId: r.conversationId,
      commentId: r.commentId,
      pagePath: r.pagePath,
      anchor: (r.anchor as Anchor | null) ?? null,
      anchorStatus: r.anchorStatus as "live" | "outdated",
      resolved: r.resolvedAt !== null,
      version: r.versionOrdinal,
      createdOrdinal: ordinalByVersion.get(r.createdVersionId) ?? 0,
      author: r.author as Identity,
      body: r.body,
      createdAt: r.createdAt.toISOString(),
      editedAt: r.editedAt ? r.editedAt.toISOString() : null,
      mentions: ments,
      reactions: Array.from(reactionsByComment.get(r.commentId)?.entries() ?? []).map(
        ([emoji, count]) => ({ emoji, count }),
      ),
    });
  }
  return dtos;
}

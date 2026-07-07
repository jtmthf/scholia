// Repository helpers over the Drizzle client. The server is the only caller
// (PLAN §1: server is the only place HTTP + db meet). These keep route handlers
// free of query plumbing and own the multi-row invariants of an upload
// (site + owner token + first Version + manifest, in one transaction).
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import {
  comments,
  conversations,
  manifestEntries,
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
  visibility: "public";
  anchor: Anchor | null;
  ownerViewerId?: null;
  // First comment fields
  firstComment: {
    versionId: string;
    body: string;
    author: Identity;
    authorViewerId: string | null;
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

    await tx.insert(comments).values({
      conversationId: conv!.id,
      versionId: input.firstComment.versionId,
      body: input.firstComment.body,
      author: input.firstComment.author,
      authorViewerId: input.firstComment.authorViewerId ?? null,
    });

    return { conversationId: conv!.id };
  });
}

export interface AddCommentInput {
  conversationId: string;
  versionId: string;
  body: string;
  author: Identity;
  authorViewerId: string | null;
}

// Add a reply comment to an existing Conversation. Returns the new comment id.
export async function addComment(
  db: Db,
  input: AddCommentInput,
): Promise<{ commentId: string }> {
  const [row] = await db
    .insert(comments)
    .values({
      conversationId: input.conversationId,
      versionId: input.versionId,
      body: input.body,
      author: input.author,
      authorViewerId: input.authorViewerId ?? null,
    })
    .returning({ commentId: comments.id });
  return { commentId: row!.commentId };
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
  comments: CommentDTO[];
}

// List all public Conversations for a Site + page. pagePath=null selects
// page-level Threads (conversations.pagePath IS NULL). Assembles DTOs in JS with
// a few targeted queries (conversations → comments → reactions) rather than a
// single giant join.
export async function listConversationsForPage(
  db: Db,
  input: { siteId: string; pagePath: string | null; viewerId: string | null },
): Promise<ConversationDTO[]> {
  // 1. Load conversations.
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

  if (convRows.length === 0) return [];

  const convIds = convRows.map((c) => c.id);

  // Map each conversation's createdVersionId → ordinal (Outdated permalink target).
  const createdVersionIds = [...new Set(convRows.map((c) => c.createdVersionId))];
  const versionRows = await db
    .select({ id: versions.id, ordinal: versions.ordinal })
    .from(versions)
    .where(inArray(versions.id, createdVersionIds));
  const ordinalByVersion = new Map(versionRows.map((v) => [v.id, v.ordinal]));

  // 2. Load comments for these conversations.
  const commentRows = await db
    .select()
    .from(comments)
    .where(
      sql`${comments.conversationId} = ANY(ARRAY[${sql.raw(convIds.map((id) => `'${id}'`).join(","))}]::uuid[])`
    )
    .orderBy(asc(comments.createdAt));

  const commentIds = commentRows.map((r) => r.id);

  // 3. Load reactions for these comments (may be empty).
  const reactionRows =
    commentIds.length > 0
      ? await db
          .select()
          .from(reactions)
          .where(
            sql`${reactions.commentId} = ANY(ARRAY[${sql.raw(commentIds.map((id) => `'${id}'`).join(","))}]::uuid[])`
          )
      : [];

  // 4. Build reaction groups per comment.
  const reactionsByComment = new Map<string, ReactionGroup[]>();
  for (const commentId of commentIds) {
    const rs = reactionRows.filter((r) => r.commentId === commentId);
    const groups = new Map<string, { count: number; mine: boolean }>();
    for (const r of rs) {
      const g = groups.get(r.emoji) ?? { count: 0, mine: false };
      g.count += 1;
      if (input.viewerId && r.authorViewerId === input.viewerId) g.mine = true;
      groups.set(r.emoji, g);
    }
    reactionsByComment.set(
      commentId,
      Array.from(groups.entries()).map(([emoji, g]) => ({ emoji, count: g.count, mine: g.mine })),
    );
  }

  // 5. Assemble DTOs.
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
      mine: input.viewerId !== null && c.authorViewerId === input.viewerId,
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
    comments: commentsByConv.get(conv.id) ?? [],
  }));
}

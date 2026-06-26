import { Hono } from "hono";
import { mapSmIdsToSourceRange, type SourceMap } from "@collab/core";
import {
  addComment,
  createConversation,
  deleteComment,
  editComment,
  getLatestManifest,
  getLatestVersionId,
  getSiteBySlug,
  listConversationsForPage,
  mintViewer,
  setResolved,
  toggleReaction,
  type Anchor,
  type ConversationDTO,
  type Identity,
} from "@collab/db";
import type { AppDeps } from "../config.js";

// Fixed review-oriented reaction palette (CONTEXT "Reaction").
const REACTION_PALETTE = new Set(["👍", "👎", "✅", "👀", "🎉", "❤️"]);

// Build a viewer-authored Identity from a display name.
function viewerIdentity(displayName: string): Identity {
  return {
    name: displayName,
    kind: "human",
    tier: "viewer",
    source: "native",
  };
}

// Fetch a hydrated ConversationDTO for a single conversation id. Used to return
// the freshly-created/updated conversation after a mutation.
async function fetchOneConversation(
  db: Parameters<typeof listConversationsForPage>[0],
  siteId: string,
  conversationId: string,
  viewerId: string | null,
): Promise<ConversationDTO | null> {
  // listConversationsForPage filters by pagePath; we don't know the pagePath
  // here, so we use a direct re-fetch via listConversationsForPage with all
  // conversations for the site and filter in JS. For M5 volumes this is fine.
  // Alternative would be a direct single-row repo, but the DTO assembly is
  // non-trivial — keeping it simple.
  const { sql, eq } = await import("drizzle-orm");
  void sql; void eq; // will not use drizzle here — delegate to a helper below
  return fetchConversationById(db, siteId, conversationId, viewerId);
}

// Direct single-conversation hydration: re-uses the listConversationsForPage
// path but filtered to one id. We do this inline to avoid a full-table scan.
async function fetchConversationById(
  db: Parameters<typeof listConversationsForPage>[0],
  siteId: string,
  conversationId: string,
  viewerId: string | null,
): Promise<ConversationDTO | null> {
  // Load all public conversations for the site (pagePath agnostic), then find
  // the one we want. For M5 this is acceptable; a dedicated repo helper can
  // replace this in M6 when volume grows.
  const { schema } = await import("@collab/db");
  const { eq, and, asc, isNull, sql: sqlt } = await import("drizzle-orm");
  void isNull; void sqlt;

  // Pull the conversation row directly.
  const [conv] = await (db as any)
    .select()
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.id, conversationId),
        eq(schema.conversations.siteId, siteId),
        eq(schema.conversations.visibility, "public"),
      ),
    )
    .limit(1);

  if (!conv) return null;

  const commentRows = await (db as any)
    .select()
    .from(schema.comments)
    .where(eq(schema.comments.conversationId, conv.id))
    .orderBy(asc(schema.comments.createdAt));

  const commentIds: string[] = commentRows.map((r: any) => r.id);

  const reactionRows =
    commentIds.length > 0
      ? await (db as any)
          .select()
          .from(schema.reactions)
          .where(
            sqlt`${schema.reactions.commentId} = ANY(ARRAY[${sqlt.raw(commentIds.map((id) => `'${id}'`).join(","))}]::uuid[])`,
          )
      : [];

  const reactionsByComment = new Map<string, Array<{ emoji: string; count: number; mine: boolean }>>();
  for (const commentId of commentIds) {
    const rs = (reactionRows as any[]).filter((r: any) => r.commentId === commentId);
    const groups = new Map<string, { count: number; mine: boolean }>();
    for (const r of rs) {
      const g = groups.get(r.emoji) ?? { count: 0, mine: false };
      g.count += 1;
      if (viewerId && r.authorViewerId === viewerId) g.mine = true;
      groups.set(r.emoji, g);
    }
    reactionsByComment.set(
      commentId,
      Array.from(groups.entries()).map(([emoji, g]) => ({
        emoji,
        count: g.count,
        mine: g.mine,
      })),
    );
  }

  const commentDTOs = commentRows.map((c: any) => {
    const deleted = c.deletedAt !== null;
    return {
      id: c.id,
      author: c.author as Identity,
      body: deleted ? "" : (c.body as string),
      createdAt: (c.createdAt as Date).toISOString(),
      editedAt: c.editedAt ? (c.editedAt as Date).toISOString() : null,
      deleted,
      mine: viewerId !== null && c.authorViewerId === viewerId,
      reactions: reactionsByComment.get(c.id) ?? [],
    };
  });

  return {
    id: conv.id as string,
    pagePath: conv.pagePath as string | null,
    anchor: (conv.anchor as Anchor | null) ?? null,
    anchorStatus: conv.anchorStatus as "live" | "outdated",
    resolved: conv.resolvedAt !== null,
    resolvedBy: conv.resolvedBy as string | null,
    comments: commentDTOs,
  };
}

export function conversationsRoutes(getDeps: () => AppDeps) {
  const app = new Hono();

  // POST /sites/:slug/viewers — mint an anonymous Viewer (CONTEXT "Viewer").
  app.post("/sites/:slug/viewers", async (c) => {
    const { db } = getDeps();
    const slug = c.req.param("slug");
    const site = await getSiteBySlug(db, slug);
    if (!site) return c.json({ error: "not found" }, 404);

    const { viewerId } = await mintViewer(db, site.id);
    return c.json({ viewerId }, 201);
  });

  // GET /sites/:slug/conversations?path=<pagePath>&viewerId=<id>
  // Returns public Threads for a page (path absent = page-level).
  app.get("/sites/:slug/conversations", async (c) => {
    const { db } = getDeps();
    const slug = c.req.param("slug");
    const site = await getSiteBySlug(db, slug);
    if (!site) return c.json({ error: "not found" }, 404);

    const pagePath = c.req.query("path") ?? null;
    const viewerId = c.req.query("viewerId") ?? null;

    const dtos = await listConversationsForPage(db, {
      siteId: site.id,
      pagePath,
      viewerId,
    });
    return c.json(dtos, 200);
  });

  // POST /sites/:slug/conversations — create a public Thread.
  app.post("/sites/:slug/conversations", async (c) => {
    const { db, store } = getDeps();
    const slug = c.req.param("slug");
    const site = await getSiteBySlug(db, slug);
    if (!site) return c.json({ error: "not found" }, 404);

    // Site state gate: only "open" sites allow new Threads (CONTEXT "Site state").
    if (site.state !== "open") return c.json({ error: "site is not open for comments" }, 403);

    const body = await c.req.json().catch(() => null);
    if (
      !body ||
      typeof body.body !== "string" ||
      body.body.trim() === "" ||
      typeof body.viewerId !== "string" ||
      typeof body.displayName !== "string"
    ) {
      return c.json({ error: "expected JSON { pagePath, anchor, body, viewerId, displayName }" }, 400);
    }

    const pagePath: string | null = typeof body.pagePath === "string" ? body.pagePath : null;
    const anchorInput = body.anchor ?? null;

    // Resolve the latest version for this site.
    const latestVersion = await getLatestVersionId(db, site.id);
    if (!latestVersion) return c.json({ error: "site has no versions" }, 400);

    // Build the stored Anchor from the request's anchorInput.
    let storedAnchor: Anchor | null = null;
    if (anchorInput && typeof anchorInput.textQuote === "object") {
      const textQuote = anchorInput.textQuote as {
        exact: string;
        prefix?: string;
        suffix?: string;
      };

      // Derive sourceRange from the Source Map if smIds are provided and a
      // pageEntry has a sourceMapHash. Team A's mapSmIdsToSourceRange may be a
      // stub returning undefined — we handle that gracefully (store anchor
      // without sourceRange).
      let sourceRange: { start: number; end: number } | undefined;
      const smIds: number[] = Array.isArray(anchorInput.smIds) ? anchorInput.smIds : [];

      if (smIds.length > 0 && pagePath) {
        const manifest = await getLatestManifest(db, slug);
        const pageEntry = manifest?.pages.find((p) => p.path === pagePath);
        if (pageEntry?.sourceMapHash) {
          try {
            const smBytes = await store.get(pageEntry.sourceMapHash);
            if (smBytes) {
              const smParsed = JSON.parse(new TextDecoder().decode(smBytes)) as SourceMap;
              sourceRange = mapSmIdsToSourceRange(smIds, smParsed);
            }
          } catch {
            // Source map fetch/parse failure is non-fatal; anchor without range.
          }
        }
      }

      storedAnchor = {
        textQuote,
        ...(sourceRange !== undefined ? { sourceRange } : {}),
        ...(typeof anchorInput.xpath === "string" ? { xpath: anchorInput.xpath } : {}),
        ...(typeof anchorInput.css === "string" ? { css: anchorInput.css } : {}),
      };
    }

    const author = viewerIdentity(body.displayName as string);

    const { conversationId } = await createConversation(db, {
      siteId: site.id,
      createdVersionId: latestVersion.id,
      pagePath,
      visibility: "public",
      anchor: storedAnchor,
      firstComment: {
        versionId: latestVersion.id,
        body: body.body as string,
        author,
        authorViewerId: body.viewerId as string,
      },
    });

    const dto = await fetchOneConversation(db, site.id, conversationId, body.viewerId as string);
    if (!dto) return c.json({ error: "internal error" }, 500);
    return c.json(dto, 201);
  });

  // POST /sites/:slug/conversations/:id/comments — add a reply.
  app.post("/sites/:slug/conversations/:id/comments", async (c) => {
    const { db } = getDeps();
    const slug = c.req.param("slug");
    const conversationId = c.req.param("id");
    const site = await getSiteBySlug(db, slug);
    if (!site) return c.json({ error: "not found" }, 404);

    if (site.state !== "open") return c.json({ error: "site is not open for comments" }, 403);

    const body = await c.req.json().catch(() => null);
    if (
      !body ||
      typeof body.body !== "string" ||
      body.body.trim() === "" ||
      typeof body.viewerId !== "string" ||
      typeof body.displayName !== "string"
    ) {
      return c.json({ error: "expected JSON { body, viewerId, displayName }" }, 400);
    }

    // Validate the conversation belongs to this site.
    const latestVersion = await getLatestVersionId(db, site.id);
    if (!latestVersion) return c.json({ error: "site has no versions" }, 400);

    // Check the conversation exists and belongs to this site.
    const { schema } = await import("@collab/db");
    const { eq, and } = await import("drizzle-orm");
    const [conv] = await (db as any)
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.id, conversationId),
          eq(schema.conversations.siteId, site.id),
        ),
      )
      .limit(1);
    if (!conv) return c.json({ error: "not found" }, 404);

    const author = viewerIdentity(body.displayName as string);
    const { commentId } = await addComment(db, {
      conversationId,
      versionId: latestVersion.id,
      body: body.body as string,
      author,
      authorViewerId: body.viewerId as string,
    });

    // Return the CommentDTO for the newly-created comment.
    const { schema: s } = await import("@collab/db");
    const { eq: eq2 } = await import("drizzle-orm");
    const [commentRow] = await (db as any)
      .select()
      .from(s.comments)
      .where(eq2(s.comments.id, commentId))
      .limit(1);

    if (!commentRow) return c.json({ error: "internal error" }, 500);

    return c.json(
      {
        id: commentRow.id,
        author: commentRow.author as Identity,
        body: commentRow.body as string,
        createdAt: (commentRow.createdAt as Date).toISOString(),
        editedAt: null,
        deleted: false,
        mine: true,
        reactions: [],
      },
      201,
    );
  });

  // PATCH /sites/:slug/comments/:id — edit own comment.
  app.patch("/sites/:slug/comments/:id", async (c) => {
    const { db } = getDeps();
    const slug = c.req.param("slug");
    const commentId = c.req.param("id");
    const site = await getSiteBySlug(db, slug);
    if (!site) return c.json({ error: "not found" }, 404);

    const body = await c.req.json().catch(() => null);
    if (
      !body ||
      typeof body.body !== "string" ||
      body.body.trim() === "" ||
      typeof body.viewerId !== "string"
    ) {
      return c.json({ error: "expected JSON { body, viewerId }" }, 400);
    }

    // Verify the comment exists and belongs to this site's conversation.
    const { schema } = await import("@collab/db");
    const { eq, and } = await import("drizzle-orm");
    const [commentRow] = await (db as any)
      .select({ id: schema.comments.id, conversationId: schema.comments.conversationId })
      .from(schema.comments)
      .where(eq(schema.comments.id, commentId))
      .limit(1);
    if (!commentRow) return c.json({ error: "not found" }, 404);

    const [convRow] = await (db as any)
      .select({ siteId: schema.conversations.siteId })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.id, commentRow.conversationId),
          eq(schema.conversations.siteId, site.id),
        ),
      )
      .limit(1);
    if (!convRow) return c.json({ error: "not found" }, 404);

    const ok = await editComment(db, {
      commentId,
      viewerId: body.viewerId as string,
      body: body.body as string,
    });
    if (!ok) return c.json({ error: "forbidden: not the author" }, 403);

    const [updated] = await (db as any)
      .select()
      .from(schema.comments)
      .where(eq(schema.comments.id, commentId))
      .limit(1);

    return c.json(
      {
        id: updated.id,
        author: updated.author as Identity,
        body: updated.body as string,
        createdAt: (updated.createdAt as Date).toISOString(),
        editedAt: updated.editedAt ? (updated.editedAt as Date).toISOString() : null,
        deleted: updated.deletedAt !== null,
        mine: true,
        reactions: [],
      },
      200,
    );
  });

  // DELETE /sites/:slug/comments/:id — tombstone own comment.
  app.delete("/sites/:slug/comments/:id", async (c) => {
    const { db } = getDeps();
    const slug = c.req.param("slug");
    const commentId = c.req.param("id");
    const site = await getSiteBySlug(db, slug);
    if (!site) return c.json({ error: "not found" }, 404);

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.viewerId !== "string") {
      return c.json({ error: "expected JSON { viewerId }" }, 400);
    }

    // Verify the comment belongs to this site.
    const { schema } = await import("@collab/db");
    const { eq, and } = await import("drizzle-orm");
    const [commentRow] = await (db as any)
      .select({ id: schema.comments.id, conversationId: schema.comments.conversationId })
      .from(schema.comments)
      .where(eq(schema.comments.id, commentId))
      .limit(1);
    if (!commentRow) return c.json({ error: "not found" }, 404);

    const [convRow] = await (db as any)
      .select({ siteId: schema.conversations.siteId })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.id, commentRow.conversationId),
          eq(schema.conversations.siteId, site.id),
        ),
      )
      .limit(1);
    if (!convRow) return c.json({ error: "not found" }, 404);

    const ok = await deleteComment(db, {
      commentId,
      viewerId: body.viewerId as string,
    });
    if (!ok) return c.json({ error: "forbidden: not the author" }, 403);

    return new Response(null, { status: 204 });
  });

  // POST /sites/:slug/conversations/:id/resolve — mark a Thread resolved.
  app.post("/sites/:slug/conversations/:id/resolve", async (c) => {
    const { db } = getDeps();
    const slug = c.req.param("slug");
    const conversationId = c.req.param("id");
    const site = await getSiteBySlug(db, slug);
    if (!site) return c.json({ error: "not found" }, 404);

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.viewerId !== "string" || typeof body.displayName !== "string") {
      return c.json({ error: "expected JSON { viewerId, displayName }" }, 400);
    }

    // Validate conversation belongs to this site.
    const { schema } = await import("@collab/db");
    const { eq, and } = await import("drizzle-orm");
    const [conv] = await (db as any)
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.id, conversationId),
          eq(schema.conversations.siteId, site.id),
        ),
      )
      .limit(1);
    if (!conv) return c.json({ error: "not found" }, 404);

    await setResolved(db, {
      conversationId,
      resolved: true,
      resolvedBy: body.displayName as string,
    });

    const dto = await fetchOneConversation(db, site.id, conversationId, body.viewerId as string);
    if (!dto) return c.json({ error: "internal error" }, 500);
    return c.json(dto, 200);
  });

  // DELETE /sites/:slug/conversations/:id/resolve — reopen a Thread.
  app.delete("/sites/:slug/conversations/:id/resolve", async (c) => {
    const { db } = getDeps();
    const slug = c.req.param("slug");
    const conversationId = c.req.param("id");
    const site = await getSiteBySlug(db, slug);
    if (!site) return c.json({ error: "not found" }, 404);

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.viewerId !== "string" || typeof body.displayName !== "string") {
      return c.json({ error: "expected JSON { viewerId, displayName }" }, 400);
    }

    // Validate conversation belongs to this site.
    const { schema } = await import("@collab/db");
    const { eq, and } = await import("drizzle-orm");
    const [conv] = await (db as any)
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.id, conversationId),
          eq(schema.conversations.siteId, site.id),
        ),
      )
      .limit(1);
    if (!conv) return c.json({ error: "not found" }, 404);

    await setResolved(db, {
      conversationId,
      resolved: false,
      resolvedBy: body.displayName as string,
    });

    const dto = await fetchOneConversation(db, site.id, conversationId, body.viewerId as string);
    if (!dto) return c.json({ error: "internal error" }, 500);
    return c.json(dto, 200);
  });

  // POST /sites/:slug/comments/:id/reactions — toggle a reaction.
  app.post("/sites/:slug/comments/:id/reactions", async (c) => {
    const { db } = getDeps();
    const slug = c.req.param("slug");
    const commentId = c.req.param("id");
    const site = await getSiteBySlug(db, slug);
    if (!site) return c.json({ error: "not found" }, 404);

    const body = await c.req.json().catch(() => null);
    if (
      !body ||
      typeof body.emoji !== "string" ||
      typeof body.viewerId !== "string" ||
      typeof body.displayName !== "string"
    ) {
      return c.json({ error: "expected JSON { emoji, viewerId, displayName }" }, 400);
    }

    if (!REACTION_PALETTE.has(body.emoji as string)) {
      return c.json({ error: "emoji not in reaction palette" }, 400);
    }

    // Verify the comment belongs to this site.
    const { schema } = await import("@collab/db");
    const { eq, and } = await import("drizzle-orm");
    const [commentRow] = await (db as any)
      .select({ id: schema.comments.id, conversationId: schema.comments.conversationId })
      .from(schema.comments)
      .where(eq(schema.comments.id, commentId))
      .limit(1);
    if (!commentRow) return c.json({ error: "not found" }, 404);

    const [convRow] = await (db as any)
      .select({ siteId: schema.conversations.siteId })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.id, commentRow.conversationId),
          eq(schema.conversations.siteId, site.id),
        ),
      )
      .limit(1);
    if (!convRow) return c.json({ error: "not found" }, 404);

    const author = viewerIdentity(body.displayName as string);
    const groups = await toggleReaction(db, {
      commentId,
      emoji: body.emoji as string,
      viewerId: body.viewerId as string,
      author,
    });

    return c.json(groups, 200);
  });

  return app;
}

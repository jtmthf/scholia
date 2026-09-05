import { Hono, type Context } from "hono";
import { mapSmIdsToSourceRange, parseMentions, type Identity, type SourceMap } from "@scholia/core";
import {
  addComment,
  createConversation,
  deleteComment,
  editComment,
  getCommentConversation,
  getConversationMeta,
  getLatestManifest,
  getLatestVersionId,
  getSiteBySlug,
  getViewer,
  listChats,
  listConversationsForPage,
  listSiteComments,
  mintViewer,
  mintViewerToken,
  ownerDeleteComment,
  ownerDeleteConversation,
  promoteConversation,
  setResolved,
  toggleReaction,
  groupReactions,
  type Anchor,
  type ConversationDTO,
  type ConversationMeta,
  type ReactionGroup,
  type SiteCommentDTO,
} from "@scholia/db";
import type { AppDeps } from "../config.js";
import { authorizeOwner, bearerOrQueryToken, resolveActor, type Actor } from "../auth.js";
import { hashToken, mintToken } from "../tokens.js";
import {
  emitCommentCreated,
  emitPromotion,
  emitResolve,
  toMirrorIdentity,
  type EmitDeps,
} from "../mirror/emit.js";
import type { schema } from "@scholia/db";

type CommentRow = typeof schema.comments.$inferSelect;
type ReactionRow = typeof schema.reactions.$inferSelect;

// Fixed review-oriented reaction palette (CONTEXT "Reaction").
const REACTION_PALETTE = new Set(["👍", "👎", "✅", "👀", "🎉", "❤️"]);

// ---- M9: Site-state gate (CONTEXT "Site state") ----
// The Site state posture gates *public* mutations; private Chats are the Viewer's
// own workspace and are always allowed (any state). Public Threads:
//   open      — everything allowed
//   read_only — public commenting (new Threads + replies) disabled; reactions and
//               resolve/reopen still allowed
//   frozen    — all public-Thread mutations locked
type StateAction = "comment" | "react" | "resolve";
function stateAllows(
  state: "open" | "read_only" | "frozen",
  action: StateAction,
  visibility: "public" | "private",
): boolean {
  if (visibility === "private") return true;
  if (state === "open") return true;
  if (state === "frozen") return false;
  return action !== "comment"; // read_only: everything but new public comments
}

function stateError(state: "open" | "read_only" | "frozen"): string {
  return state === "frozen"
    ? "site is frozen: public Threads are locked"
    : "site is read-only: public commenting is disabled";
}

// Build the EmitDeps the outbound mirror helpers need (M10). null `mirrorBinding`
// short-circuits every emit, so non-PR-backed Sites pay nothing.
function emitDeps(
  deps: AppDeps,
  site: {
    id: string;
    state: "open" | "read_only" | "frozen";
    mirrorBinding: { provider: string; repo: string; prNumber: number } | null;
  },
): EmitDeps {
  return {
    mirrorBinding: site.mirrorBinding,
    siteId: site.id,
    siteState: site.state,
    mirrorBus: deps.mirrorBus,
  };
}

// ---- M9: per-Viewer/IP rate limiting on comment creation ----
// The client IP for anonymous callers (behind a proxy). Best-effort — the header
// is spoofable, but this is an abuse speed-bump, not an auth boundary.
function clientIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim() || "anon";
  return c.req.header("x-real-ip") ?? "anon";
}

// A stable per-caller subject for the rate limiter: the viewer/agent identity when
// known, else the client IP.
function rateSubject(actor: Actor, humanViewerId: string | null, c: Context): string {
  if (actor.tier === "viewer") return `v:${actor.viewerId}`;
  if (actor.tier === "owner") return `o:${actor.identity.name}`;
  return `h:${humanViewerId ?? clientIp(c)}`;
}

// Charge one comment-creation against the limiter; returns a 429 Response (with
// Retry-After) when over the limit, else null. Applies regardless of Site state
// (CONTEXT "Site state").
async function rateLimited(
  c: Context,
  deps: AppDeps,
  siteId: string,
  subject: string,
): Promise<Response | null> {
  const res = await deps.rateLimiter.hit(`${siteId}:${subject}`);
  if (res.ok) return null;
  const retrySec = Math.max(1, Math.ceil((res.retryAfterMs ?? 0) / 1000));
  c.header("Retry-After", String(retrySec));
  return c.json({ error: "rate limit exceeded; slow down and retry shortly" }, 429);
}

// Build a viewer-authored (human) Identity from a display name.
function viewerIdentity(displayName: string): Identity {
  return {
    name: displayName,
    kind: "human",
    tier: "viewer",
    source: "native",
  };
}

// Build a stored Anchor from an agent/token-supplied request body. Agents pass
// textQuote (and optionally sourceRange/xpath/css) directly — no smIds→sourceRange
// Source Map lookup because agents don't have smIds (browser-side Source Map ids,
// CONTEXT "Anchor").
function agentAnchor(anchorInput: Record<string, unknown>): Anchor | null {
  if (!anchorInput || typeof anchorInput.textQuote !== "object") return null;
  const textQuote = anchorInput.textQuote as { exact: string; prefix?: string; suffix?: string };
  return {
    textQuote,
    ...(anchorInput.sourceRange !== null &&
    anchorInput.sourceRange !== undefined &&
    typeof anchorInput.sourceRange === "object"
      ? { sourceRange: anchorInput.sourceRange as { start: number; end: number } }
      : {}),
    ...(typeof anchorInput.xpath === "string" ? { xpath: anchorInput.xpath } : {}),
    ...(typeof anchorInput.css === "string" ? { css: anchorInput.css } : {}),
  };
}

// M8 access guard (ADR-0006). Public Conversations (Threads) are unchanged: any
// token or viewer may act. Private Conversations (Chats) are visible/writable
// ONLY to the owning Viewer — either its agent (Viewer-scoped token whose
// viewerId matches) or the human holding the viewerId. Owner tokens are refused:
// owners do not own Chats. `humanViewerId` is the body-supplied viewerId (the
// possession-based human path); it is ignored when a token resolved the actor.
type Access = { allowed: true } | { allowed: false; status: 403; error: string };
function checkConversationAccess(
  meta: ConversationMeta,
  actor: Actor,
  humanViewerId: string | null,
): Access {
  if (meta.visibility === "public") return { allowed: true };
  // Private Chat.
  if (actor.tier === "owner") {
    return { allowed: false, status: 403, error: "owners do not have access to Chats" };
  }
  if (actor.tier === "viewer") {
    return actor.viewerId === meta.ownerViewerId
      ? { allowed: true }
      : { allowed: false, status: 403, error: "forbidden: not the Chat owner" };
  }
  // Anonymous (no token): possession-based human viewerId.
  return humanViewerId !== null && humanViewerId === meta.ownerViewerId
    ? { allowed: true }
    : { allowed: false, status: 403, error: "forbidden: not the Chat owner" };
}

// Direct single-conversation hydration by id + Site, regardless of visibility
// (callers gate access). Excludes Promotion-hidden (M8) and renders tombstones
// with an empty body; reports `visibility` so the viewer can badge Chat vs Thread.
async function fetchConversationById(
  db: AppDeps["db"],
  siteId: string,
  conversationId: string,
  viewerId: string | null,
): Promise<ConversationDTO | null> {
  const { schema } = await import("@scholia/db");
  const { eq, and, asc, isNull, inArray } = await import("drizzle-orm");

  const [conv] = await db
    .select()
    .from(schema.conversations)
    .where(
      and(eq(schema.conversations.id, conversationId), eq(schema.conversations.siteId, siteId)),
    )
    .limit(1);
  if (!conv) return null;

  const [createdVersion] = await db
    .select({ ordinal: schema.versions.ordinal })
    .from(schema.versions)
    .where(eq(schema.versions.id, conv.createdVersionId))
    .limit(1);

  const commentRows = await db
    .select()
    .from(schema.comments)
    .where(and(eq(schema.comments.conversationId, conv.id), isNull(schema.comments.hiddenAt)))
    .orderBy(asc(schema.comments.createdAt));

  const commentIds: string[] = commentRows.map((r: CommentRow) => r.id);

  const reactionRows =
    commentIds.length > 0
      ? await db
          .select()
          .from(schema.reactions)
          .where(inArray(schema.reactions.commentId, commentIds))
      : [];

  const reactionsByComment = new Map<string, ReactionGroup[]>();
  for (const commentId of commentIds) {
    const rs = reactionRows.filter((r: ReactionRow) => r.commentId === commentId);
    reactionsByComment.set(commentId, groupReactions(rs, viewerId));
  }

  const commentDTOs = commentRows.map((c: CommentRow) => {
    const deleted = c.deletedAt !== null;
    return {
      id: c.id,
      author: c.author,
      body: deleted ? "" : c.body,
      createdAt: c.createdAt.toISOString(),
      editedAt: c.editedAt ? c.editedAt.toISOString() : null,
      deleted,
      mine: viewerId !== null && c.authorViewerId === viewerId,
      reactions: reactionsByComment.get(c.id) ?? [],
    };
  });

  return {
    id: conv.id,
    pagePath: conv.pagePath,
    anchor: conv.anchor ?? null,
    anchorStatus: conv.anchorStatus,
    createdOrdinal: createdVersion?.ordinal ?? 0,
    resolved: conv.resolvedAt !== null,
    resolvedBy: conv.resolvedBy,
    visibility: conv.visibility,
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

  // POST /sites/:slug/viewers/:viewerId/agent-token — mint a Viewer-scoped agent
  // token (M8, ADR-0006 tier 2). Possession of the unguessable viewerId is the
  // authorization; re-minting revokes the Viewer's prior live token.
  app.post("/sites/:slug/viewers/:viewerId/agent-token", async (c) => {
    const deps = getDeps();
    const { db } = deps;
    const slug = c.req.param("slug");
    const viewerId = c.req.param("viewerId");
    const site = await getSiteBySlug(db, slug);
    if (!site) return c.json({ error: "not found" }, 404);

    const viewer = await getViewer(db, viewerId, site.id);
    if (!viewer) return c.json({ error: "not found" }, 404);

    const token = mintToken();
    await mintViewerToken(db, { siteId: site.id, viewerId, tokenHash: hashToken(token) });
    return c.json({ token, agentUrl: `${deps.viewerUrl}/s/${slug}?token=${token}` }, 201);
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

  // GET /sites/:slug/chats?path=<pagePath>&since=<ISO>
  // Returns the caller's private Chats (M8). Auth is a Viewer-scoped token (the
  // Viewer's agent) OR ?viewerId= (the human, possession-based). No identity →
  // 401; an owner-only token → 403 (owners do not have Chats). `path` absent
  // returns Chats across all Pages (the `list_chats --since` polling feed).
  app.get("/sites/:slug/chats", async (c) => {
    const deps = getDeps();
    const { db } = deps;
    const slug = c.req.param("slug");

    const auth = await resolveActor(c, deps, slug);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);

    let viewerId: string;
    if (auth.actor.tier === "viewer") {
      viewerId = auth.actor.viewerId;
    } else if (auth.actor.tier === "owner") {
      return c.json({ error: "owners do not have Chats" }, 403);
    } else {
      const q = c.req.query("viewerId");
      if (!q) return c.json({ error: "viewer identity required" }, 401);
      viewerId = q;
    }

    const pagePath = c.req.query("path"); // undefined = all pages
    const since = c.req.query("since") ?? undefined;
    const dtos = await listChats(db, { siteId: auth.site.id, viewerId, pagePath, since });
    return c.json(dtos, 200);
  });

  // GET /sites/:slug/comments?unresolved&since=<ISO>&mentions=<name>
  // Site-wide flat comment feed for the agent `list_comments` verb (M7). No token
  // required — Share-URL-gated read surface, like /conversations (ADR-0001).
  // `unresolved` treated as boolean by presence (any value counts as true).
  app.get("/sites/:slug/comments", async (c) => {
    const { db } = getDeps();
    const slug = c.req.param("slug");
    const site = await getSiteBySlug(db, slug);
    if (!site) return c.json({ error: "not found" }, 404);

    const unresolved = c.req.query("unresolved") !== undefined ? true : undefined;
    const since = c.req.query("since") ?? undefined;
    const mentionsQ = c.req.query("mentions") ?? undefined;

    const comments: SiteCommentDTO[] = await listSiteComments(db, {
      siteId: site.id,
      unresolved,
      since,
      mentions: mentionsQ,
    });
    return c.json({ comments }, 200);
  });

  // POST /sites/:slug/conversations — create a Thread (public) or Chat (private).
  // Token callers (owner or Viewer-scoped agent) attribute writes to the resolved
  // agent Identity; otherwise the human viewer path (viewerId + displayName).
  // A private Chat requires a viewer identity — owner tokens are refused (owners
  // do not own Chats). A Viewer-scoped token may also create public Threads.
  app.post("/sites/:slug/conversations", async (c) => {
    const deps = getDeps();
    const { db, store } = deps;
    const slug = c.req.param("slug");
    const site = await getSiteBySlug(db, slug);
    if (!site) return c.json({ error: "not found" }, 404);

    const body = await c.req.json().catch(() => null);
    const visibility: "public" | "private" = body?.visibility === "private" ? "private" : "public";

    // Site state gate (M9): public Threads honor the state posture; private Chats
    // are always allowed (the Viewer's own workspace, CONTEXT "Site state").
    if (!stateAllows(site.state, "comment", visibility)) {
      return c.json({ error: stateError(site.state) }, 403);
    }

    if (bearerOrQueryToken(c) !== null) {
      // ---- Token path: owner or Viewer-scoped agent ----
      if (!body || typeof body.body !== "string" || body.body.trim() === "") {
        return c.json(
          { error: "expected JSON { pagePath?, anchor?, body, label?, visibility? }" },
          400,
        );
      }
      const auth = await resolveActor(c, deps, slug, body.label ?? null);
      if (!auth.ok) return c.json({ error: auth.error }, auth.status);
      const actor = auth.actor;

      if (visibility === "private" && actor.tier !== "viewer") {
        return c.json({ error: "owners do not own Chats" }, 403);
      }

      const latestVersion = await getLatestVersionId(db, site.id);
      if (!latestVersion) return c.json({ error: "site has no versions" }, 400);

      const pagePath: string | null = typeof body.pagePath === "string" ? body.pagePath : null;
      const storedAnchor = agentAnchor(body.anchor ?? null);
      const ownerViewerId =
        visibility === "private" && actor.tier === "viewer" ? actor.viewerId : null;

      const limited = await rateLimited(c, deps, site.id, rateSubject(actor, null, c));
      if (limited) return limited;

      const agentMentions = parseMentions(body.body as string);
      const identity = actor.tier === "anonymous" ? viewerIdentity("Reviewer") : actor.identity;
      const { conversationId, firstCommentId } = await createConversation(db, {
        siteId: site.id,
        createdVersionId: latestVersion.id,
        pagePath,
        visibility,
        anchor: storedAnchor,
        ownerViewerId,
        firstComment: {
          versionId: latestVersion.id,
          body: body.body as string,
          author: identity,
          authorViewerId: null,
          mentions: agentMentions,
        },
      });

      // M10: mirror a new public Thread's first comment to GitHub (no-op on
      // non-PR-backed Sites or Chats). Best-effort, never blocks the response.
      emitCommentCreated(emitDeps(deps, site), {
        conversationId,
        commentId: firstCommentId,
        pagePath,
        createdVersionId: latestVersion.id,
        author: toMirrorIdentity(identity),
        body: body.body as string,
        anchor: storedAnchor,
        visibility,
      });

      const dto = await fetchConversationById(db, site.id, conversationId, null);
      if (!dto) return c.json({ error: "internal error" }, 500);
      return c.json(dto, 201);
    }

    // ---- Human viewer path (no token) ----
    if (
      !body ||
      typeof body.body !== "string" ||
      body.body.trim() === "" ||
      typeof body.viewerId !== "string" ||
      typeof body.displayName !== "string"
    ) {
      return c.json(
        { error: "expected JSON { pagePath, anchor, body, viewerId, displayName, visibility? }" },
        400,
      );
    }

    const pagePath: string | null = typeof body.pagePath === "string" ? body.pagePath : null;
    const anchorInput = body.anchor ?? null;

    const latestVersion = await getLatestVersionId(db, site.id);
    if (!latestVersion) return c.json({ error: "site has no versions" }, 400);

    // Build the stored Anchor, resolving smIds→sourceRange via the Source Map.
    let storedAnchor: Anchor | null = null;
    if (anchorInput && typeof anchorInput.textQuote === "object") {
      const textQuote = anchorInput.textQuote as {
        exact: string;
        prefix?: string;
        suffix?: string;
      };
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

    const limited = await rateLimited(c, deps, site.id, `h:${body.viewerId as string}`);
    if (limited) return limited;

    const author = viewerIdentity(body.displayName as string);
    const viewerMentions = parseMentions(body.body as string);
    const ownerViewerId = visibility === "private" ? (body.viewerId as string) : null;

    const { conversationId, firstCommentId } = await createConversation(db, {
      siteId: site.id,
      createdVersionId: latestVersion.id,
      pagePath,
      visibility,
      anchor: storedAnchor,
      ownerViewerId,
      firstComment: {
        versionId: latestVersion.id,
        body: body.body as string,
        author,
        authorViewerId: body.viewerId as string,
        mentions: viewerMentions,
      },
    });

    // M10: mirror a new public Thread's first comment to GitHub (no-op on
    // non-PR-backed Sites or Chats). Best-effort, never blocks the response.
    emitCommentCreated(emitDeps(deps, site), {
      conversationId,
      commentId: firstCommentId,
      pagePath,
      createdVersionId: latestVersion.id,
      author: toMirrorIdentity(author),
      body: body.body as string,
      anchor: storedAnchor,
      visibility,
    });

    const dto = await fetchConversationById(db, site.id, conversationId, body.viewerId as string);
    if (!dto) return c.json({ error: "internal error" }, 500);
    return c.json(dto, 201);
  });

  // POST /sites/:slug/conversations/:id/comments — add a reply.
  // Token callers (owner or Viewer agent) attribute to the agent Identity; the
  // human path uses viewerId + displayName. Private Chats enforce the M8 guard.
  app.post("/sites/:slug/conversations/:id/comments", async (c) => {
    const deps = getDeps();
    const { db } = deps;
    const slug = c.req.param("slug");
    const conversationId = c.req.param("id");
    const site = await getSiteBySlug(db, slug);
    if (!site) return c.json({ error: "not found" }, 404);

    const body = await c.req.json().catch(() => null);

    const auth = await resolveActor(c, deps, slug, body?.label ?? null);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);
    const actor = auth.actor;

    const meta = await getConversationMeta(db, conversationId, site.id);
    if (!meta) return c.json({ error: "not found" }, 404);

    const humanViewerId = typeof body?.viewerId === "string" ? body.viewerId : null;
    const access = checkConversationAccess(meta, actor, humanViewerId);
    if (!access.allowed) return c.json({ error: access.error }, access.status);

    // Site state gate (M9): replies to a public Thread honor the posture; Chat
    // replies are always allowed. Then charge the rate limiter (CONTEXT "Site state").
    if (!stateAllows(site.state, "comment", meta.visibility)) {
      return c.json({ error: stateError(site.state) }, 403);
    }
    const limited = await rateLimited(c, deps, site.id, rateSubject(actor, humanViewerId, c));
    if (limited) return limited;

    const latestVersion = await getLatestVersionId(db, site.id);
    if (!latestVersion) return c.json({ error: "site has no versions" }, 400);

    if (actor.tier !== "anonymous") {
      // ---- Agent reply (owner or viewer tier) ----
      if (!body || typeof body.body !== "string" || body.body.trim() === "") {
        return c.json({ error: "expected JSON { body, label? }" }, 400);
      }
      const agentMentions = parseMentions(body.body as string);
      const { commentId } = await addComment(db, {
        conversationId,
        versionId: latestVersion.id,
        body: body.body as string,
        author: actor.identity,
        authorViewerId: null,
        mentions: agentMentions,
      });

      // M10: mirror a public-Thread reply to GitHub (best-effort, no-op on
      // non-PR-backed Sites or Chats). Uses the conversation's anchor so the
      // reply lands in the same review thread on the PR.
      emitCommentCreated(emitDeps(deps, site), {
        conversationId,
        commentId,
        pagePath: meta.pagePath,
        createdVersionId: meta.createdVersionId,
        author: toMirrorIdentity(actor.identity),
        body: body.body as string,
        anchor: meta.anchor,
        visibility: meta.visibility,
      });

      return c.json(await newCommentDTO(db, commentId, false), 201);
    }

    // ---- Human viewer reply ----
    if (
      !body ||
      typeof body.body !== "string" ||
      body.body.trim() === "" ||
      typeof body.viewerId !== "string" ||
      typeof body.displayName !== "string"
    ) {
      return c.json({ error: "expected JSON { body, viewerId, displayName }" }, 400);
    }

    const author = viewerIdentity(body.displayName as string);
    const viewerMentions = parseMentions(body.body as string);
    const { commentId } = await addComment(db, {
      conversationId,
      versionId: latestVersion.id,
      body: body.body as string,
      author,
      authorViewerId: body.viewerId as string,
      mentions: viewerMentions,
    });

    // M10: mirror a public-Thread reply to GitHub (best-effort, no-op on
    // non-PR-backed Sites or Chats).
    emitCommentCreated(emitDeps(deps, site), {
      conversationId,
      commentId,
      pagePath: meta.pagePath,
      createdVersionId: meta.createdVersionId,
      author: toMirrorIdentity(author),
      body: body.body as string,
      anchor: meta.anchor,
      visibility: meta.visibility,
    });

    return c.json(await newCommentDTO(db, commentId, true), 201);
  });

  // PATCH /sites/:slug/comments/:id — edit own comment (author-only).
  app.patch("/sites/:slug/comments/:id", async (c) => {
    const deps = getDeps();
    const { db } = deps;
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

    const link = await getCommentConversation(db, commentId, site.id);
    if (!link) return c.json({ error: "not found" }, 404);

    // Private-Chat access guard (Owner tokens refused, cross-viewer refused).
    const auth = await resolveActor(c, deps, slug);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);
    const meta = await getConversationMeta(db, link.conversationId, site.id);
    if (!meta) return c.json({ error: "not found" }, 404);
    const access = checkConversationAccess(meta, auth.actor, body.viewerId as string);
    if (!access.allowed) return c.json({ error: access.error }, access.status);

    const ok = await editComment(db, {
      commentId,
      viewerId: body.viewerId as string,
      body: body.body as string,
    });
    if (!ok) return c.json({ error: "forbidden: not the author" }, 403);

    return c.json(await newCommentDTO(db, commentId, true), 200);
  });

  // DELETE /sites/:slug/comments/:id — tombstone a comment.
  // Owner-token callers may delete any comment on a public Thread (M7 agent tier);
  // viewers delete only their own. Private Chats enforce the M8 guard (owner
  // tokens refused).
  app.delete("/sites/:slug/comments/:id", async (c) => {
    const deps = getDeps();
    const { db } = deps;
    const slug = c.req.param("slug");
    const commentId = c.req.param("id");
    const site = await getSiteBySlug(db, slug);
    if (!site) return c.json({ error: "not found" }, 404);

    const body = await c.req.json().catch(() => null);

    const link = await getCommentConversation(db, commentId, site.id);
    if (!link) return c.json({ error: "not found" }, 404);

    const auth = await resolveActor(c, deps, slug, body?.label ?? null);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);
    const actor = auth.actor;

    const meta = await getConversationMeta(db, link.conversationId, site.id);
    if (!meta) return c.json({ error: "not found" }, 404);
    const humanViewerId = typeof body?.viewerId === "string" ? body.viewerId : null;
    const access = checkConversationAccess(meta, actor, humanViewerId);
    if (!access.allowed) return c.json({ error: access.error }, access.status);

    if (actor.tier === "owner") {
      // Owner-delete any comment (public Thread only; guard blocked private above).
      const deleted = await ownerDeleteComment(db, { commentId, siteId: site.id });
      if (!deleted) return c.json({ error: "not found" }, 404);
      return new Response(null, { status: 204 });
    }

    // Viewer / human: author-only delete.
    if (humanViewerId === null) {
      return c.json({ error: "expected JSON { viewerId }" }, 400);
    }
    const ok = await deleteComment(db, { commentId, viewerId: humanViewerId });
    if (!ok) return c.json({ error: "forbidden: not the author" }, 403);
    return new Response(null, { status: 204 });
  });

  // POST /sites/:slug/conversations/:id/resolve — mark resolved.
  app.post("/sites/:slug/conversations/:id/resolve", (c) => resolveHandler(c, getDeps, true));
  // DELETE /sites/:slug/conversations/:id/resolve — reopen.
  app.delete("/sites/:slug/conversations/:id/resolve", (c) => resolveHandler(c, getDeps, false));

  // POST /sites/:slug/conversations/:id/promote — Promotion (CONTEXT "Promotion").
  // Flip a private Chat to a public Thread in place: keep the selected comments
  // visible, hide the rest, optionally prepend a summary. Only the owning Viewer
  // (human viewerId or its agent token) may promote.
  app.post("/sites/:slug/conversations/:id/promote", async (c) => {
    const deps = getDeps();
    const { db } = deps;
    const slug = c.req.param("slug");
    const conversationId = c.req.param("id");
    const site = await getSiteBySlug(db, slug);
    if (!site) return c.json({ error: "not found" }, 404);

    const body = await c.req.json().catch(() => null);
    if (!body || !Array.isArray(body.commentIds)) {
      return c.json(
        { error: "expected JSON { commentIds: string[], summary?, viewerId?, label? }" },
        400,
      );
    }

    const auth = await resolveActor(c, deps, slug, body.label ?? null);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);
    const actor = auth.actor;

    const meta = await getConversationMeta(db, conversationId, site.id);
    if (!meta) return c.json({ error: "not found" }, 404);
    if (meta.visibility !== "private") {
      return c.json({ error: "conversation is not a Chat" }, 400);
    }

    // Owning-viewer only. Resolve the summary Identity from the caller.
    let summaryAuthor: Identity;
    let summaryAuthorViewerId: string | null;
    const humanViewerId = typeof body.viewerId === "string" ? body.viewerId : null;
    if (actor.tier === "viewer") {
      if (actor.viewerId !== meta.ownerViewerId) {
        return c.json({ error: "forbidden: not the Chat owner" }, 403);
      }
      summaryAuthor = actor.identity;
      summaryAuthorViewerId = null;
    } else if (actor.tier === "owner") {
      return c.json({ error: "owners do not own Chats" }, 403);
    } else {
      if (humanViewerId === null || humanViewerId !== meta.ownerViewerId) {
        return c.json({ error: "forbidden: not the Chat owner" }, 403);
      }
      const viewer = await getViewer(db, humanViewerId, site.id);
      summaryAuthor = viewerIdentity(viewer?.displayName ?? "Reviewer");
      summaryAuthorViewerId = humanViewerId;
    }

    await promoteConversation(db, {
      conversationId,
      keepCommentIds: (body.commentIds as unknown[]).filter(
        (x): x is string => typeof x === "string",
      ),
      summary: typeof body.summary === "string" ? body.summary : undefined,
      summaryAuthor,
      summaryAuthorViewerId,
    });

    const dto = await fetchConversationById(db, site.id, conversationId, summaryAuthorViewerId);
    if (!dto) return c.json({ error: "internal error" }, 500);

    // M10: Promotion is the push-to-GitHub trigger (ADR-0008). Each now-visible
    // (kept + summary) comment becomes a new public Thread comment mirrored to
    // GitHub. The original Chat comments stay private (never mirrored). No-op on
    // non-PR-backed Sites. Best-effort, never blocks the response.
    emitPromotion(emitDeps(deps, site), {
      conversationId,
      pagePath: meta.pagePath,
      createdVersionId: meta.createdVersionId,
      visibility: "public",
      comments: dto.comments.map((cm) => ({
        commentId: cm.id,
        author: toMirrorIdentity(cm.author),
        body: cm.body,
        anchor: meta.anchor,
      })),
    });

    return c.json(dto, 200);
  });

  // DELETE /sites/:slug/conversations/:id — owner-delete an entire Conversation
  // (CONTEXT "Owner": "delete any Comment/Conversation"). A destructive moderation
  // power: the Owner may remove any Thread OR Chat (even one they can't read),
  // distinct from the M8 content-access guard. Owner-token only (header), never a
  // viewer token. Cascades the Conversation's comments/reactions/mentions.
  app.delete("/sites/:slug/conversations/:id", async (c) => {
    const deps = getDeps();
    const slug = c.req.param("slug");
    const conversationId = c.req.param("id");

    const auth = await authorizeOwner(c, deps, slug);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);

    const deleted = await ownerDeleteConversation(deps.db, {
      conversationId,
      siteId: auth.site.id,
    });
    if (!deleted) return c.json({ error: "not found" }, 404);
    return new Response(null, { status: 204 });
  });

  // POST /sites/:slug/comments/:id/reactions — toggle a reaction.
  // Token callers (owner or viewer agent) toggle keyed by (commentId, emoji,
  // author.name); humans toggle keyed by viewerId. Private Chats enforce the guard.
  app.post("/sites/:slug/comments/:id/reactions", async (c) => {
    const deps = getDeps();
    const { db } = deps;
    const slug = c.req.param("slug");
    const commentId = c.req.param("id");
    const site = await getSiteBySlug(db, slug);
    if (!site) return c.json({ error: "not found" }, 404);

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.emoji !== "string") {
      return c.json({ error: "expected JSON { emoji, ... }" }, 400);
    }
    if (!REACTION_PALETTE.has(body.emoji as string)) {
      return c.json({ error: "emoji not in reaction palette" }, 400);
    }

    const link = await getCommentConversation(db, commentId, site.id);
    if (!link) return c.json({ error: "not found" }, 404);

    const auth = await resolveActor(c, deps, slug, body.label ?? null);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);
    const actor = auth.actor;

    const meta = await getConversationMeta(db, link.conversationId, site.id);
    if (!meta) return c.json({ error: "not found" }, 404);
    const humanViewerId = typeof body.viewerId === "string" ? body.viewerId : null;
    const access = checkConversationAccess(meta, actor, humanViewerId);
    if (!access.allowed) return c.json({ error: access.error }, access.status);

    // Site state gate (M9): reactions on a public Thread are blocked when frozen.
    if (!stateAllows(site.state, "react", meta.visibility)) {
      return c.json({ error: stateError(site.state) }, 403);
    }

    if (actor.tier !== "anonymous") {
      // ---- Agent reaction: toggle keyed by (commentId, emoji, author.name) ----
      const { schema } = await import("@scholia/db");
      const { eq, and, sql: sqlt } = await import("drizzle-orm");
      const [existing] = await db
        .select({ id: schema.reactions.id })
        .from(schema.reactions)
        .where(
          and(
            eq(schema.reactions.commentId, commentId),
            eq(schema.reactions.emoji, body.emoji as string),
            sqlt`(${schema.reactions.author}->>'name') = ${actor.identity.name}`,
          ),
        )
        .limit(1);

      if (existing) {
        await db.delete(schema.reactions).where(eq(schema.reactions.id, existing.id));
      } else {
        await db.insert(schema.reactions).values({
          commentId,
          emoji: body.emoji as string,
          author: actor.identity,
          authorViewerId: null,
        });
      }

      const allReactions = await db
        .select({ emoji: schema.reactions.emoji })
        .from(schema.reactions)
        .where(eq(schema.reactions.commentId, commentId));
      const rgroups = new Map<string, number>();
      for (const r of allReactions) rgroups.set(r.emoji, (rgroups.get(r.emoji) ?? 0) + 1);
      return c.json(
        Array.from(rgroups.entries()).map(([emoji, count]) => ({ emoji, count, mine: false })),
        200,
      );
    }

    // ---- Human viewer reaction ----
    if (humanViewerId === null || typeof body.displayName !== "string") {
      return c.json({ error: "expected JSON { emoji, viewerId, displayName }" }, 400);
    }
    const author = viewerIdentity(body.displayName as string);
    const groups = await toggleReaction(db, {
      commentId,
      emoji: body.emoji as string,
      viewerId: humanViewerId,
      author,
    });
    return c.json(groups, 200);
  });

  return app;
}

// Shared resolve/reopen handler. Token callers (owner or viewer agent) set
// resolvedBy to the agent name; humans use their display name. Private Chats
// enforce the M8 guard.
async function resolveHandler(c: Context, getDeps: () => AppDeps, resolved: boolean) {
  const deps = getDeps();
  const { db } = deps;
  const slug = c.req.param("slug")!;
  const conversationId = c.req.param("id")!;
  const site = await getSiteBySlug(db, slug);
  if (!site) return c.json({ error: "not found" }, 404);

  const body = await c.req.json().catch(() => null);

  const auth = await resolveActor(c, deps, slug, body?.label ?? null);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);
  const actor = auth.actor;

  const meta = await getConversationMeta(db, conversationId, site.id);
  if (!meta) return c.json({ error: "not found" }, 404);
  const humanViewerId = typeof body?.viewerId === "string" ? body.viewerId : null;
  const access = checkConversationAccess(meta, actor, humanViewerId);
  if (!access.allowed) return c.json({ error: access.error }, access.status);

  // Site state gate (M9): resolve/reopen on a public Thread is locked when frozen.
  if (!stateAllows(site.state, "resolve", meta.visibility)) {
    return c.json({ error: stateError(site.state) }, 403);
  }

  let resolvedBy: string;
  let viewerId: string | null;
  if (actor.tier !== "anonymous") {
    resolvedBy = actor.identity.name;
    viewerId = null;
  } else {
    if (humanViewerId === null || typeof body?.displayName !== "string") {
      return c.json({ error: "expected JSON { viewerId, displayName }" }, 400);
    }
    resolvedBy = body.displayName as string;
    viewerId = humanViewerId;
  }

  await setResolved(db, { conversationId, resolved, resolvedBy });

  // M10: mirror resolve/reopen on a public Thread to GitHub (best-effort, no-op
  // on non-PR-backed Sites or Chats). Resolve has no comment_mirrors row of its
  // own; the bus dispatches against an already-synced comment's review thread.
  emitResolve(emitDeps(deps, site), {
    conversationId,
    pagePath: meta.pagePath,
    createdVersionId: meta.createdVersionId,
    resolved,
    resolvedBy,
    visibility: meta.visibility,
  });

  const dto = await fetchConversationById(db, site.id, conversationId, viewerId);
  if (!dto) return c.json({ error: "internal error" }, 500);
  return c.json(dto, 200);
}

// Fetch a single newly-created/edited comment as a CommentDTO (fresh reactions
// are always empty; `mine` is caller-supplied).
async function newCommentDTO(db: AppDeps["db"], commentId: string, mine: boolean) {
  const { schema } = await import("@scholia/db");
  const { eq } = await import("drizzle-orm");
  const [row] = await db
    .select()
    .from(schema.comments)
    .where(eq(schema.comments.id, commentId))
    .limit(1);
  // Every caller passes an id it just wrote in the same request, so a miss means
  // the row was deleted underneath us. Say that, rather than letting the reads
  // below throw a bare TypeError on `undefined`.
  if (!row) throw new Error(`comment ${commentId} disappeared before it could be returned`);
  return {
    id: row.id,
    author: row.author,
    body: row.deletedAt !== null ? "" : row.body,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    deleted: row.deletedAt !== null,
    mine,
    reactions: [],
  };
}

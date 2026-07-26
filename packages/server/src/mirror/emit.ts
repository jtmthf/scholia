// Outbound mirror emit helpers (M10). The conversation routes call these right
// after a successful DB write that should mirror to a PR-backed Site's GitHub.
// Each helper:
//   1. skips cheaply when the Site isn't PR-backed GitHub, or the mutation is
//      private (Chats are Scholia-only), or the Site state blocks public mutation;
//   2. builds the `MirrorEvent` from the just-written rows;
//   3. hands it to `mirrorBus.emit`, which persists a pending `comment_mirrors`
//      row and dispatches to the provider asynchronously.
//
// Emit never throws into the request — failures are caught in the bus.

import type { Anchor, MirrorBinding, MirrorEvent, MirrorIdentity } from "@scholia/core";

export interface EmitDeps {
  /** null when the Site isn't PR-backed — emit is a no-op then. */
  mirrorBinding: MirrorBinding | null;
  siteId: string;
  /** The Site state posture; `frozen` skips new public comments (M9 gate). */
  siteState: "open" | "read_only" | "frozen";
  mirrorBus: { emit(event: MirrorEvent): void };
}

// DB-side Identity mirror. The route already built an `Identity` for the write;
// converts to the core `MirrorIdentity` shape (structurally compatible, decoupled).
export function toMirrorIdentity(i: {
  name: string;
  kind: "human" | "agent";
  tier: "owner" | "viewer";
  onBehalfOf?: string;
  source: "native" | "github";
}): MirrorIdentity {
  return { ...i };
}

export function toMirrorAnchor(a: Anchor | null): Anchor | null {
  return a;
}

// Emit a newly-created first comment on a public Conversation (a new public Thread
// or a public-anchored comment). Private Chats are never emitted — callers gate.
export function emitCommentCreated(
  deps: EmitDeps,
  input: {
    conversationId: string;
    commentId: string;
    pagePath: string | null;
    createdVersionId: string;
    author: MirrorIdentity;
    body: string;
    anchor: Anchor | null;
    visibility: "public" | "private";
  },
): void {
  if (input.visibility !== "public") return;
  if (deps.siteState === "frozen") return;
  if (deps.mirrorBinding === null || deps.mirrorBinding.provider !== "github") return;
  const event: MirrorEvent = {
    type: "comment_created",
    siteId: deps.siteId,
    mirrorBinding: deps.mirrorBinding,
    conversationId: input.conversationId,
    pagePath: input.pagePath,
    createdVersionId: input.createdVersionId,
    commentId: input.commentId,
    author: input.author,
    body: input.body,
    anchor: input.anchor,
    origin: "scholia",
  };
  deps.mirrorBus.emit(event);
}

// Emit a resolve (true) or reopen (false) on a public Conversation. Resolve has
// no comment_mirrors row of its own; the bus dispatches it best-effort against
// the thread of an already-synced comment.
export function emitResolve(
  deps: EmitDeps,
  input: {
    conversationId: string;
    pagePath: string | null;
    createdVersionId: string;
    resolved: boolean;
    resolvedBy: string;
    visibility: "public" | "private";
  },
): void {
  if (input.visibility !== "public") return;
  if (deps.mirrorBinding === null || deps.mirrorBinding.provider !== "github") return;
  const event: MirrorEvent = {
    type: "resolve",
    siteId: deps.siteId,
    mirrorBinding: deps.mirrorBinding,
    conversationId: input.conversationId,
    pagePath: input.pagePath,
    createdVersionId: input.createdVersionId,
    resolved: input.resolved,
    resolvedBy: input.resolvedBy,
  };
  deps.mirrorBus.emit(event);
}

// Emit a promotion: each kept + summary comment is pushed as a new public Thread
// comment. The original Chat comments are NOT pushed (they were private). The
// promoting viewer selected which messages go public (CONTEXT "Promotion").
export function emitPromotion(
  deps: EmitDeps,
  input: {
    conversationId: string;
    pagePath: string | null;
    createdVersionId: string;
    visibility: "public" | "private"; // only fires when now public
    comments: Array<{
      commentId: string;
      author: MirrorIdentity;
      body: string;
      anchor: Anchor | null;
    }>;
  },
): void {
  if (input.visibility !== "public") return;
  if (deps.siteState === "frozen") return;
  if (deps.mirrorBinding === null || deps.mirrorBinding.provider !== "github") return;
  if (input.comments.length === 0) return;
  const event: MirrorEvent = {
    type: "promotion",
    siteId: deps.siteId,
    mirrorBinding: deps.mirrorBinding,
    conversationId: input.conversationId,
    pagePath: input.pagePath,
    createdVersionId: input.createdVersionId,
    comments: input.comments,
  };
  deps.mirrorBus.emit(event);
}
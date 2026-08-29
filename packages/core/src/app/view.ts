// The Conversation as an agent sees it (ADR-0020, ADR-0021).
//
// One JSON shape for every surface and every target: `scholia comments --json`
// prints it, `list_conversations` over MCP returns it, and both the Sidecar and
// the hosted REST API are mapped into it by their adapters. That is what makes
// "the same capabilities on both" true of the *output* as well as the verb list
// — an agent that learned to read one surface can read the other.
//
// snake_case because this is wire copy read by an LLM, not a TypeScript value
// passed between our own modules, and because it is what the CLI has always
// printed.

import type { Anchor } from "../anchor/types.js";
import type { AuthorKind, Conversation, Visibility } from "../conversation/types.js";

/** One emoji's tally on a Comment. `authors` only where the target knows them. */
export interface ReactionView {
  emoji: string;
  count: number;
  /**
   * Who is reacting. The Sidecar records this per author; the hosted API
   * aggregates to a count, so an agent must treat it as optional.
   */
  authors?: string[];
}

export interface CommentView {
  id: string;
  author: string;
  author_kind: AuthorKind;
  timestamp: string;
  /** Empty once the Comment is a tombstone — see `deleted`. */
  body: string;
  edited_at: string | null;
  deleted: boolean;
  reactions: ReactionView[];
}

export interface PromotionView {
  thread_id: string;
  comment_ids: string[];
  timestamp: string;
}

export interface ConversationView {
  id: string;
  /** Repo-relative Page path, or null for a Conversation with no Page. */
  page: string | null;
  /** Private (a Chat) or public (a Thread) — CONTEXT "Conversation". */
  visibility: Visibility;
  author: string;
  timestamp: string;
  anchor: Anchor | null;
  resolved: boolean;
  resolved_by: string | null;
  comment_count: number;
  comments: CommentView[];
  /** Promotions recorded on a Chat: each selection that became a public Thread. */
  promotions: PromotionView[];
  /** When this Thread was promoted from a Chat, the Chat it came from. */
  promoted_from?: { conversation_id: string; comment_ids: string[] };
}

/** The folded domain Conversation as the shape both surfaces hand out. */
export function toConversationView(conversation: Conversation): ConversationView {
  return {
    id: conversation.header.id,
    page: conversation.header.page,
    visibility: conversation.visibility,
    author: conversation.header.author,
    timestamp: conversation.header.timestamp,
    anchor: conversation.header.anchor,
    resolved: conversation.resolved,
    resolved_by: conversation.resolvedBy,
    comment_count: conversation.comments.length,
    comments: conversation.comments.map((comment) => ({
      id: comment.id,
      author: comment.author,
      author_kind: comment.authorKind,
      timestamp: comment.timestamp,
      body: comment.body,
      edited_at: comment.editedAt,
      deleted: comment.deleted,
      reactions: comment.reactions.map((reaction) => ({
        emoji: reaction.emoji,
        count: reaction.authors.length,
        authors: reaction.authors,
      })),
    })),
    promotions: conversation.promotions.map((p) => ({
      thread_id: p.threadId,
      comment_ids: p.commentIds,
      timestamp: p.timestamp,
    })),
    ...(conversation.header.promotedFrom
      ? {
          promoted_from: {
            conversation_id: conversation.header.promotedFrom.conversationId,
            comment_ids: conversation.header.promotedFrom.commentIds,
          },
        }
      : {}),
  };
}

// Conversation domain types (ADR-0018, ADR-0019).
// Pure domain shape — no Drizzle, no HTTP, no db.
// Conversation is the aggregate root: Comments live inside its boundary.

import type { Anchor } from "../anchor/types.js";
import type { Provenance } from "../util/provenance.js";

/** UUIDv7 assigned by the application (ADR-0019). */
export type ConversationId = string;

/** UUIDv7 assigned by the application. */
export type CommentId = string;

/**
 * The immutable Conversation header (document 0 in the multi-document YAML
 * stream per ADR-0019). Written once at creation and never modified.
 */
export interface ConversationHeader {
  id: ConversationId;
  /** The Page this Conversation is attached to, as a repo-relative path. */
  page: string;
  /** The original Anchor, or null for a page-level Conversation. */
  anchor: Anchor | null;
  /**
   * sha256 of the Page's Source as it stood when the Conversation was started
   * — the binding (CONTEXT "Comment"). Captured when the Page was rendered, not
   * re-read at submit, so it names the bytes the author was actually looking at.
   * Optional because a Conversation can be created against content with no file
   * behind it (the CLI's `--page` takes a path, not a Page).
   */
  contentHash?: string;
  /**
   * Best-effort git facts at creation time (ADR-0007, ADR-0018). Context, never
   * the binding: the dominant local case is commenting on output an agent has
   * just written and not committed. Absent outside a git repository.
   */
  provenance?: Provenance;
  /** The author who created the Conversation. */
  author: string;
  /** ISO 8601 creation timestamp. */
  timestamp: string;
}

/**
 * A `comment` event (documents 1..n in the YAML stream). A Conversation's first
 * Comment and every reply are the same event kind — a reply is an append, not a
 * different shape. Edits, reactions and resolves are separate tickets that widen
 * the same seam.
 */
export interface CommentEvent {
  id: CommentId;
  type: "comment";
  timestamp: string;
  author: string;
  body: string;
}

/**
 * A single Comment, folded from events at read time.
 */
export interface Comment {
  id: CommentId;
  conversationId: ConversationId;
  author: string;
  body: string;
  timestamp: string;
}

/**
 * Folded read model: one Conversation with its resolved Comments.
 */
export interface Conversation {
  header: ConversationHeader;
  comments: Comment[];
}

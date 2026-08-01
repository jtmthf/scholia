// Conversation domain types (ADR-0018, ADR-0019).
// Pure domain shape — no Drizzle, no HTTP, no db.
// Conversation is the aggregate root: Comments live inside its boundary.

import type { Anchor } from "../anchor/types.js";

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
  /** The author who created the Conversation. */
  author: string;
  /** ISO 8601 creation timestamp. */
  timestamp: string;
}

/**
 * A `comment` event (documents 1..n in the YAML stream).
 * Only `comment` is supported in this tracer bullet; edits, reactions and
 * resolves are separate tickets that widen the same seam.
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

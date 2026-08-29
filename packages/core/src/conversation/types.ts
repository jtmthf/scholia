// Conversation domain types (ADR-0018, ADR-0019, ADR-0032).
// Pure domain shape — no Drizzle, no HTTP, no db.
// Conversation is the aggregate root: Comments live inside its boundary.

import type { Anchor } from "../anchor/types.js";
import type { Provenance } from "../util/provenance.js";

/** UUIDv7 assigned by the application (ADR-0019). */
export type ConversationId = string;

/** UUIDv7 assigned by the application. */
export type CommentId = string;

/**
 * Private (a Chat) or public (a Thread) — CONTEXT "Conversation".
 *
 * Never a field in the stream. ADR-0019 puts Threads and Chats in separate
 * directories so visibility is enforced by the filesystem: a `visibility:` field
 * would be a string a single `git add` blows straight through, and it could
 * disagree with the directory the file is actually in. Adapters report where they
 * found a Conversation; nothing writes this down.
 */
export type Visibility = "public" | "private";

/**
 * Whether a Comment was written by a person or by an agent (CONTEXT "Identity").
 *
 * Locally there are no tokens and no Viewer records, so an agent simply declares
 * its own name — this is the one bit that distinguishes it, and it is what puts
 * the agent badge on the Comment. Absent means human, so a stream written before
 * agents could sign their work reads back exactly as it did.
 */
export type AuthorKind = "human" | "agent";

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
  /** Omitted for a human, so a header only says so when there is something to say. */
  authorKind?: AuthorKind;
  /** ISO 8601 creation timestamp. */
  timestamp: string;
  /**
   * When this Thread was promoted from a Chat, the Chat it came from and the
   * Comments that were carried across (CONTEXT "Promotion").
   */
  promotedFrom?: { conversationId: string; commentIds: string[] };
}

/** What every event document in the stream carries (ADR-0019). */
interface EventBase {
  /** UUIDv7 — the dedup key, and the tiebreak when timestamps collide. */
  id: string;
  /** ISO 8601. Ordering comes from here, never from file position. */
  timestamp: string;
  /** Who did it. Recorded on every event, including resolve and reopen. */
  author: string;
  /**
   * Omitted for a human. Written only when an agent did it, so every document a
   * person wrote is byte-identical to what it was before agents could sign
   * theirs — and an older Scholia reading a newer stream simply doesn't see it.
   */
  authorKind?: AuthorKind;
}

/**
 * A `comment` event (documents 1..n in the YAML stream). A Conversation's first
 * Comment and every reply are the same event kind — a reply is an append, not a
 * different shape.
 */
export interface CommentEvent extends EventBase {
  type: "comment";
  body: string;
}

/** New body text for a Comment. The original `comment` event stays in the stream. */
export interface EditedEvent extends EventBase {
  type: "edited";
  target: CommentId;
  body: string;
}

/**
 * A tombstone. `target` is a Comment's id, or the Conversation's own id when the
 * whole Conversation is being deleted — nothing is removed from the stream either
 * way (ADR-0032).
 */
export interface DeletedEvent extends EventBase {
  type: "deleted";
  /** A `CommentId`, or the `ConversationId` of the Conversation this belongs to. */
  target: string;
}

/** One reaction from one author, from the fixed palette (CONTEXT "Reaction"). */
export interface ReactedEvent extends EventBase {
  type: "reacted";
  target: CommentId;
  emoji: string;
}

/** Taking a reaction back. The `reacted` event it undoes stays in the stream. */
export interface UnreactedEvent extends EventBase {
  type: "unreacted";
  target: CommentId;
  emoji: string;
}

/** The Conversation is settled. Reopening is its own event, not a retraction. */
export interface ResolvedEvent extends EventBase {
  type: "resolved";
}

export interface ReopenedEvent extends EventBase {
  type: "reopened";
}

/**
 * A Promotion: the Chat records which of its Comments became which public Thread
 * (CONTEXT "Promotion"). This is an event rather than header mutation because a
 * Chat can be promoted multiple times with different selections.
 */
export interface PromotedEvent extends EventBase {
  type: "promoted";
  /** The public Thread that was written from this Chat. */
  threadId: string;
  /** The Comment ids that were promoted, in Chat order. */
  commentIds: string[];
}

/**
 * One Promotion recorded on a Chat: a selection of its Comments and the Thread
 * they became (CONTEXT "Promotion").
 */
export interface PromotionRecord {
  threadId: string;
  commentIds: string[];
  timestamp: string;
}

/**
 * Every state change a Conversation can undergo, as an appendable document.
 * There is no other way to change one: the header is immutable and no event is
 * ever rewritten, which is what makes git's union merge correct here rather than
 * a hazard (ADR-0019).
 */
export type ConversationEvent =
  | CommentEvent
  | EditedEvent
  | DeletedEvent
  | ReactedEvent
  | UnreactedEvent
  | ResolvedEvent
  | ReopenedEvent
  | PromotedEvent;

/** One emoji's tally on a Comment, folded from `reacted`/`unreacted` events. */
export interface Reaction {
  emoji: string;
  /** The authors currently reacting, sorted — so two folds agree exactly. */
  authors: string[];
}

/**
 * A single Comment, folded from events at read time.
 */
export interface Comment {
  id: CommentId;
  conversationId: ConversationId;
  author: string;
  /** Always present once folded — an event that says nothing is a human. */
  authorKind: AuthorKind;
  /** The latest edited body, or "" once the Comment is a tombstone. */
  body: string;
  timestamp: string;
  /** When the winning `edited` event was written, or null if never edited. */
  editedAt: string | null;
  /** A tombstone: the Comment was deleted, and its body is gone. */
  deleted: boolean;
  reactions: Reaction[];
}

/**
 * Folded read model: one Conversation with its resolved Comments and state.
 */
export interface Conversation {
  header: ConversationHeader;
  /**
   * Where the adapter found this Conversation, not something it read out of the
   * stream (ADR-0019 — see `Visibility`).
   */
  visibility: Visibility;
  comments: Comment[];
  resolved: boolean;
  /** Who resolved it, when it is resolved. Null otherwise. */
  resolvedBy: string | null;
  resolvedAt: string | null;
  /** A tombstone over the whole aggregate — the file stays, the Conversation goes. */
  deleted: boolean;
  /**
   * Promotions recorded on this Chat: each selection that became a public Thread
   * (CONTEXT "Promotion"). Empty for a Thread that was never a Chat.
   */
  promotions: PromotionRecord[];
}

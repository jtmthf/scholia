// The Conversation shapes the comment layer renders. Deliberately free of
// hosted-only vocabulary: no Site slug, no token, no Version — a delivery package
// maps its own transport onto these before handing them to the components.
//
// `createdOrdinal` is the one exception, and it stays optional: hosted Sites number
// their Versions, Local Preview has none (CONTEXT "Version"). The rail never reads
// it directly — it asks the consumer for an origin link (see `OutdatedOrigin`).

/** The author of a Comment or Reaction (CONTEXT "Identity"). */
export interface Identity {
  name: string;
  kind: "human" | "agent";
  tier: "owner" | "viewer";
  onBehalfOf?: string;
  source: "native" | "github";
}

export interface TextQuote {
  exact: string;
  prefix?: string;
  suffix?: string;
}

/** Where a Conversation attaches to a Page (CONTEXT "Anchor"). */
export interface Anchor {
  textQuote: TextQuote;
  sourceRange?: { start: number; end: number };
  xpath?: string;
  css?: string;
}

/** One emoji's tally on a Comment, with whether the reader is among them. */
export interface ReactionGroup {
  emoji: string;
  count: number;
  mine: boolean;
  /** Names of everyone who reacted with this emoji, sorted. */
  authors: string[];
}

export interface CommentDTO {
  id: string;
  author: Identity;
  /** Empty string when the Comment is a tombstone (`deleted` true). */
  body: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  /** Whether the reader authored this Comment (edit/delete affordances). */
  mine: boolean;
  reactions: ReactionGroup[];
}

export interface PromotionDTO {
  threadId: string;
  commentIds: string[];
  timestamp: string;
}

export interface ConversationDTO {
  id: string;
  /** The Page this Conversation is on; null for a Page-level Conversation. */
  pagePath: string | null;
  /** Anchored span; null for a Page-level Conversation (no highlight). */
  anchor: Anchor | null;
  anchorStatus: "live" | "outdated";
  resolved: boolean;
  resolvedBy: string | null;
  /** Private (a Chat) vs public (a Thread) — CONTEXT "Conversation". */
  visibility: "public" | "private";
  comments: CommentDTO[];
  /** Hosted only: the Version ordinal this Conversation was created on. */
  createdOrdinal?: number;
  /** Promotions recorded on a Chat: each selection that became a public Thread. */
  promotions?: PromotionDTO[];
  /** When this Thread was promoted from a Chat, where it came from. */
  promotedFrom?: { conversationId: string; commentIds: string[] };
}

/**
 * The fixed review-oriented reaction palette (CONTEXT "Reaction").
 *
 * The same six literals as `@scholia/core`'s `REACTION_PALETTE`, which is where
 * the domain enforces them. They are copied rather than imported because this
 * package depends on nothing but Preact (ADR-0030), and core's tree — shiki,
 * katex, an S3 client — has no business inside a comment layer that has to run
 * anywhere. `packages/local/test/conversations.test.ts` depends on both packages
 * and asserts the two lists are identical, so the copy cannot drift.
 */
export const REACTION_PALETTE = ["👍", "👎", "✅", "👀", "🎉", "❤️"] as const;

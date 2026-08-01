// ConversationRepository port (ADR-0018, ADR-0020).
// Owned by @scholia/core beside MirrorProvider — pure domain shape,
// no Drizzle or HTTP types in its signatures.
// Extracted narrowly: only the Conversation surface for this tracer bullet.

import type { Conversation, ConversationHeader, CommentEvent } from "./types.js";

/** Input for creating a new Conversation with its first Comment. */
export interface CreateConversationInput {
  header: ConversationHeader;
  firstComment: CommentEvent;
}

/**
 * The port that every storage adapter must implement.
 * Postgres adapts it in @scholia/db; the Sidecar adapter lives in @scholia/cli.
 */
export interface ConversationRepository {
  /** Create a new Conversation with its first Comment. */
  createConversation(input: CreateConversationInput): Promise<Conversation>;
  /** List all Conversations attached to the given Page path. */
  listConversations(pagePath: string): Promise<Conversation[]>;
}

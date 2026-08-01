// ConversationRepository port (ADR-0018, ADR-0020).
// Owned by @scholia/core beside MirrorProvider — pure domain shape,
// no Drizzle or HTTP types in its signatures.
//
// The port is deliberately narrow: create an aggregate, append an event to one,
// read one back, list the ones on a Page. Every verb in the Conversation set —
// reply, edit, delete, react, resolve, reopen — is `appendEvent` with a
// different document, which is what keeps "nothing is ever mutated" (ADR-0019) a
// property of the *port* rather than of each adapter's discipline.

import type { Conversation, ConversationEvent, ConversationHeader } from "./types.js";

/** Input for creating a new Conversation with its first Comment. */
export interface CreateConversationInput {
  header: ConversationHeader;
  firstComment: ConversationEvent & { type: "comment" };
}

/**
 * The port that every storage adapter must implement.
 * Postgres adapts it in @scholia/db; the Sidecar adapter lives in @scholia/sidecar.
 */
export interface ConversationRepository {
  /** Create a new Conversation with its first Comment. */
  createConversation(input: CreateConversationInput): Promise<Conversation>;
  /**
   * Append one event to an existing Conversation. Rejects when no Conversation
   * carries that id — the aggregate has to exist to be appended to.
   */
  appendEvent(conversationId: string, event: ConversationEvent): Promise<void>;
  /**
   * One Conversation, folded — including a deleted one, so a caller can tell
   * "already gone" from "never existed". Null when nothing carries that id.
   */
  getConversation(conversationId: string): Promise<Conversation | null>;
  /** List the Conversations attached to the given Page path. */
  listConversations(pagePath: string): Promise<Conversation[]>;
}

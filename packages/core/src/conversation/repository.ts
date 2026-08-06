// ConversationRepository port (ADR-0018, ADR-0020).
// Owned by @scholia/core beside MirrorProvider — pure domain shape,
// no Drizzle or HTTP types in its signatures.
//
// The port is deliberately narrow: create an aggregate, append an event to one,
// read one back, list the ones on a Page. Every verb in the Conversation set —
// reply, edit, delete, react, resolve, reopen — is `appendEvent` with a
// different document, which is what keeps "nothing is ever mutated" (ADR-0019) a
// property of the *port* rather than of each adapter's discipline.

import type { Conversation, ConversationEvent, ConversationHeader, Visibility } from "./types.js";

/** Input for creating a new Conversation with its first Comment. */
export interface CreateConversationInput {
  header: ConversationHeader;
  firstComment: ConversationEvent & { type: "comment" };
  /**
   * Private (a Chat) or public (a Thread). Defaults to public — the Thread is
   * the default for review comments (CONTEXT "Thread").
   *
   * The adapter's job, not the stream's: ADR-0019 enforces visibility by which
   * directory the file goes in, so this decides *where* the Conversation is
   * written rather than what is written into it.
   */
  visibility?: Visibility;
  /**
   * Further events written into the same initial stream, after `firstComment`.
   *
   * A Conversation is normally created with exactly one Comment and grows by
   * appending. Promotion is the exception: it writes a new Thread that already
   * carries the Chat messages a human chose (CONTEXT "Promotion"), and those
   * have to land in the same atomic write as the header — a half-written Thread
   * would be a Promotion that lost some of what it promoted.
   */
  events?: ConversationEvent[];
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
  /**
   * The Conversations attached to the given Page path, or — when no path is
   * given — every Conversation the store holds. Agents ask the second question
   * ("what is outstanding anywhere?") as often as the first, and a store that
   * could only answer per-Page would make that N calls (ADR-0021).
   */
  listConversations(pagePath?: string): Promise<Conversation[]>;
}

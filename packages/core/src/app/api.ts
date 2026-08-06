// The application layer's command and query set (ADR-0020), as an interface.
//
// This is the "same interface" the CLI and MCP both reach: in-process against
// the Sidecar when the target is local (@scholia/sidecar), over HTTP when it is
// remote (@scholia/client). Neither surface knows which one it got — the
// abstraction is the use case, not the wire.
//
// Every input is a plain object of primitives, because both surfaces produce
// one from an untyped bag: cac hands over parsed flags, MCP hands over JSON.

import type { ConversationView, CommentView } from "./view.js";

/**
 * Who is acting.
 *
 * Locally there are no tokens (CONTEXT "Identity"): the human comes from git
 * config and an agent declares its own name. Remotely it is the `label` on a
 * token-authenticated write. Both are the same field to the caller.
 */
export interface ActingAs {
  /** The agent's own name. Omitted when a person is running the command. */
  agent?: string;
}

/**
 * What narrows a listing. Carried identically by both surfaces and both
 * targets — locally the fold is filtered in `core`, remotely the server does
 * it (ADR-0020).
 */
export interface ListInput {
  /** Page path. Omitted lists every Page. */
  page?: string;
  /** Only Conversations nobody has resolved. */
  unresolved?: boolean;
  /** ISO 8601; only Conversations with a Comment written or edited since then. */
  since?: string;
  /** Only Conversations mentioning this identity (CONTEXT "Mention"). */
  mentions?: string;
}

export interface CommentInput extends ActingAs {
  page: string;
  body: string;
  /** Exact quote to anchor to. Page-level when absent (ADR-0002). */
  anchor?: string;
  prefix?: string;
  suffix?: string;
  /** Start a private Chat rather than a public Thread (CONTEXT "Chat"). */
  chat?: boolean;
}

export interface ReplyInput extends ActingAs {
  conversation: string;
  body: string;
}

export interface ReactInput extends ActingAs {
  conversation: string;
  comment: string;
  emoji: string;
  /** Take the reaction back instead of adding it. */
  remove?: boolean;
}

export interface ConversationRefInput extends ActingAs {
  conversation: string;
}

export interface CommentRefInput extends ConversationRefInput {
  comment: string;
}

export interface EditCommentInput extends CommentRefInput {
  body: string;
}

export interface PromoteInput {
  conversation: string;
  /** Which Chat Comments become public. */
  comments: string[];
  summary?: string;
}

/** A Reaction that landed, and which way. */
export interface ReactionResult {
  conversation: string;
  comment: string;
  emoji: string;
  /** True when the Reaction is now on the Comment, false when it was taken back. */
  on: boolean;
}

export interface ResolvedResult {
  conversation: string;
  resolved: boolean;
}

export interface DeletedResult {
  conversation: string;
  /** The Comment that was tombstoned, or null when the whole Conversation was. */
  comment: string | null;
  deleted: true;
}

/**
 * Every verb, once. Adding one here is what lights it up on the CLI and over
 * MCP alike (ADR-0021) — there is nowhere else to add one.
 */
export interface ConversationApi {
  listConversations(input: ListInput): Promise<ConversationView[]>;
  listChats(input: ListInput): Promise<ConversationView[]>;
  comment(input: CommentInput): Promise<ConversationView>;
  reply(input: ReplyInput): Promise<CommentView>;
  react(input: ReactInput): Promise<ReactionResult>;
  resolve(input: ConversationRefInput): Promise<ResolvedResult>;
  reopen(input: ConversationRefInput): Promise<ResolvedResult>;
  editComment(input: EditCommentInput): Promise<CommentView>;
  deleteComment(input: CommentRefInput): Promise<DeletedResult>;
  deleteConversation(input: ConversationRefInput): Promise<DeletedResult>;
  promote(input: PromoteInput): Promise<ConversationView>;
}

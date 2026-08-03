// promoteConversation use case (CONTEXT "Promotion", ADR-0019).
//
// Promotion writes a **new** Thread carrying the messages a human chose, and
// leaves the Chat exactly where it was. It is not a move.
//
// That is forced by ADR-0019, and it is the better shape anyway. Visibility is
// enforced by which directory a Conversation lives in, so "flipping" a Chat
// would mean deleting a file from the private directory and adding one to the
// shareable one — a delete-and-add in every diff, of a file whose whole purpose
// was never to be in a diff. Copying instead means the private original stays
// private and nothing about it changes.
//
// The consequence to be honest about: nothing marks the Chat as promoted, so
// promoting twice writes two Threads. That is the literal reading of "leaving
// the Chat untouched", and the alternative — an event appended to the Chat —
// would be writing to the aggregate this command exists not to disturb.
//
// Only a human promotes (CONTEXT "Promotion": "the promoting human selects
// which messages become public"), which is why there is no `authorKind` here.
// An agent may write in a Chat all it likes; deciding what the rest of the team
// gets to read is not its call.

import { v7 as uuidv7 } from "uuid";
import { ConversationError } from "./errors.js";
import { requireConversation } from "./guards.js";
import type { ConversationRepository } from "./repository.js";
import type { CommentEvent, Conversation, ConversationHeader } from "./types.js";

export interface PromoteConversationParams {
  /** The Chat being promoted. Must be private. */
  conversationId: string;
  /** Which of its Comments become public, in any order. */
  commentIds: string[];
  /** An optional note from the promoting human, added as a closing Comment. */
  summary?: string;
  /** The human doing the promoting — the new Thread's author. */
  author: string;
}

/**
 * Write a new public Thread from a Chat's chosen messages.
 *
 * Returns the Thread. The Chat is not read back, because nothing happened to it.
 */
export async function promoteConversation(
  repo: ConversationRepository,
  params: PromoteConversationParams,
): Promise<Conversation> {
  const chat = await requireConversation(repo, params.conversationId);

  if (chat.visibility !== "private") {
    throw new ConversationError("invalid", "that Conversation is already a public Thread");
  }

  const summary = params.summary?.trim() ?? "";

  // Refuse an unknown or deleted id rather than skipping it. The caller is
  // naming messages it believes are in this Chat, and quietly dropping one would
  // publish something other than what the human chose — in the one command where
  // "not quite what I picked" is unrecoverable, because it is now public.
  const chosen = params.commentIds.map((commentId) => {
    const comment = chat.comments.find((c) => c.id === commentId);
    if (!comment) {
      throw new ConversationError(
        "not-found",
        `no Comment ${commentId} in Chat ${params.conversationId}`,
      );
    }
    if (comment.deleted) {
      throw new ConversationError("invalid", "a deleted Comment cannot be promoted");
    }
    return comment;
  });

  if (chosen.length === 0 && !summary) {
    throw new ConversationError(
      "invalid",
      "promoting needs at least one Comment or a summary — an empty Thread says nothing",
    );
  }

  // Fold order, not the order the caller listed them in: the Thread should read
  // the way the Chat did.
  chosen.sort((a, b) => chat.comments.indexOf(a) - chat.comments.indexOf(b));

  const now = new Date().toISOString();

  // Each promoted message keeps its author and its timestamp, and takes a new
  // id. Keeping the timestamp is what makes the Thread read as the conversation
  // that actually happened; a new id is required because the two Conversations
  // are separate aggregates and an id is unique across the Sidecar.
  const promoted: CommentEvent[] = chosen.map((comment) => ({
    id: uuidv7(),
    type: "comment",
    timestamp: comment.timestamp,
    author: comment.author,
    // Carried across, so an agent's contribution is still marked as one once it
    // is public — the badge is about who wrote the words, not who published them.
    ...(comment.authorKind === "agent" ? { authorKind: comment.authorKind } : {}),
    body: comment.body,
  }));

  // The summary is written now, so the fold — which orders by timestamp — puts
  // it last, after the messages it is summarising. That is also where the
  // Promotion UI puts the field, and it is the only honest option: dating it
  // before the conversation it summarises would be a lie in the record.
  if (summary) {
    promoted.push({
      id: uuidv7(),
      type: "comment",
      timestamp: now,
      author: params.author,
      body: summary,
    });
  }

  // The Thread is about the same passage, in the same state, as the Chat: page,
  // Anchor, content hash and Provenance all come across unchanged. What is new
  // is who made it public and when.
  const header: ConversationHeader = {
    id: uuidv7(),
    page: chat.header.page,
    anchor: chat.header.anchor,
    ...(chat.header.contentHash ? { contentHash: chat.header.contentHash } : {}),
    ...(chat.header.provenance ? { provenance: chat.header.provenance } : {}),
    author: params.author,
    timestamp: now,
  };

  // `firstComment` plus the rest in one write. Promotion is the reason the port
  // takes `events` at all: a Thread that landed with only some of the chosen
  // messages would be a Promotion that silently published less than it was told
  // to (see CreateConversationInput).
  const [firstComment, ...rest] = promoted as [CommentEvent, ...CommentEvent[]];

  return repo.createConversation({
    header,
    firstComment,
    visibility: "public",
    ...(rest.length > 0 ? { events: rest } : {}),
  });
}

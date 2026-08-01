// What every Conversation command has to establish before it appends anything.
//
// An event is only ever appended after the aggregate has been read and checked,
// because the stream cannot say no: an `edited` event naming someone else's
// Comment is a perfectly well-formed document, and the fold would honour it. The
// authorization is here, at the seam, not in the store.

import { ConversationError } from "./errors.js";
import type { ConversationRepository } from "./repository.js";
import type { Comment, Conversation } from "./types.js";

/** The Conversation, or a rejection a reader can be shown. */
export async function requireConversation(
  repo: ConversationRepository,
  conversationId: string,
): Promise<Conversation> {
  const conversation = await repo.getConversation(conversationId);
  if (!conversation || conversation.deleted) {
    throw new ConversationError("not-found", `no Conversation ${conversationId} in the Sidecar`);
  }
  return conversation;
}

/** The Comment within it, or a rejection. */
export function requireComment(conversation: Conversation, commentId: string): Comment {
  const comment = conversation.comments.find((c) => c.id === commentId);
  if (!comment) {
    throw new ConversationError(
      "not-found",
      `no Comment ${commentId} in Conversation ${conversation.header.id}`,
    );
  }
  return comment;
}

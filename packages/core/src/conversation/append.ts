// appendComment use case (ADR-0018, ADR-0019, ADR-0020).
// Application-layer command: add a reply to an existing Conversation.
//
// A reply is the same `comment` event as the Conversation's first Comment — the
// header is immutable and every state change is an event, so replying appends a
// document to the stream rather than editing anything (ADR-0019).

import { v7 as uuidv7 } from "uuid";
import type { ConversationRepository } from "./repository.js";
import type { Comment, CommentEvent } from "./types.js";

export interface AppendCommentParams {
  conversationId: string;
  body: string;
  author: string;
}

/**
 * Append a Comment to an existing Conversation.
 *
 * Generates an application-assigned UUIDv7 id for the Comment (ADR-0019), then
 * delegates the append to the repository.
 */
export async function appendComment(
  repo: ConversationRepository,
  params: AppendCommentParams,
): Promise<Comment> {
  const event: CommentEvent = {
    id: uuidv7(),
    type: "comment",
    timestamp: new Date().toISOString(),
    author: params.author,
    body: params.body,
  };

  await repo.appendComment(params.conversationId, event);

  return {
    id: event.id,
    conversationId: params.conversationId,
    author: event.author,
    body: event.body,
    timestamp: event.timestamp,
  };
}

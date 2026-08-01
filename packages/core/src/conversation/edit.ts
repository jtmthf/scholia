// editComment use case (ADR-0019, ADR-0032).
//
// An edit is an `edited` event carrying the new body. The `comment` event it
// supersedes stays in the stream, so what the Comment used to say is still on
// disk — an edit hides text from the rail, it does not erase it.
//
// Author-only, with no moderator override. The Owner may *delete* anyone's
// Comment (that is moderation), but nobody may put words in someone else's
// mouth.

import { v7 as uuidv7 } from "uuid";
import { ConversationError } from "./errors.js";
import { requireComment, requireConversation } from "./guards.js";
import type { ConversationRepository } from "./repository.js";
import type { Comment, EditedEvent } from "./types.js";

export interface EditCommentParams {
  conversationId: string;
  commentId: string;
  body: string;
  /** The acting author — must be the one who wrote the Comment. */
  author: string;
}

export async function editComment(
  repo: ConversationRepository,
  params: EditCommentParams,
): Promise<Comment> {
  const body = params.body.trim();
  if (!body) throw new ConversationError("invalid", "a comment needs a body");

  const conversation = await requireConversation(repo, params.conversationId);
  const comment = requireComment(conversation, params.commentId);

  if (comment.deleted) {
    throw new ConversationError("not-found", "that Comment has been deleted");
  }
  if (comment.author !== params.author) {
    throw new ConversationError("forbidden", "only the author of a Comment can edit it");
  }

  const event: EditedEvent = {
    id: uuidv7(),
    type: "edited",
    timestamp: new Date().toISOString(),
    author: params.author,
    target: params.commentId,
    body,
  };

  await repo.appendEvent(params.conversationId, event);

  return { ...comment, body: event.body, editedAt: event.timestamp };
}

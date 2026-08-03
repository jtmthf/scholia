// deleteComment / deleteConversation use cases (ADR-0019, ADR-0032).
//
// Both are tombstones — a `deleted` event appended to the stream. Nothing is
// removed: not the document that is being deleted, not the file it lives in.
// What changes is what the fold shows, which is the only place "deleted" has
// ever meant anything here.
//
// Two people may delete a Comment: its author, and the Owner (CONTEXT "Owner").
// A whole Conversation is the Owner's alone — it holds other people's words.

import { v7 as uuidv7 } from "uuid";
import { signedBy } from "./author.js";
import { ConversationError } from "./errors.js";
import { requireComment, requireConversation } from "./guards.js";
import type { ConversationRepository } from "./repository.js";
import type { AuthorKind, DeletedEvent } from "./types.js";

export interface DeleteCommentParams {
  conversationId: string;
  commentId: string;
  /** The acting author. */
  author: string;
  authorKind?: AuthorKind;
  /** Whether this actor may moderate — locally, the reader at this machine. */
  isOwner?: boolean;
}

export interface DeleteConversationParams {
  conversationId: string;
  author: string;
  authorKind?: AuthorKind;
  isOwner?: boolean;
}

export async function deleteComment(
  repo: ConversationRepository,
  params: DeleteCommentParams,
): Promise<void> {
  const conversation = await requireConversation(repo, params.conversationId);
  const comment = requireComment(conversation, params.commentId);

  // Authorize before anything else, including before noticing the Comment is
  // already gone: a stranger must get the same "you may not" either way, or the
  // difference between the two answers tells them what they were not allowed to
  // know.
  if (comment.author !== params.author && !params.isOwner) {
    throw new ConversationError(
      "forbidden",
      "only the author of a Comment, or the Owner, can delete it",
    );
  }

  // Already a tombstone. Appending a second one would fold identically, so the
  // only thing another event buys is noise in a file people read in diffs.
  if (comment.deleted) return;

  await repo.appendEvent(
    params.conversationId,
    tombstone(params.author, params.authorKind, params.commentId),
  );
}

export async function deleteConversation(
  repo: ConversationRepository,
  params: DeleteConversationParams,
): Promise<void> {
  if (!params.isOwner) {
    throw new ConversationError("forbidden", "only the Owner can delete a whole Conversation");
  }

  const conversation = await requireConversation(repo, params.conversationId);

  // The Conversation's own id as the target is what makes this the whole
  // aggregate rather than one Comment inside it.
  await repo.appendEvent(
    params.conversationId,
    tombstone(params.author, params.authorKind, conversation.header.id),
  );
}

function tombstone(
  author: string,
  authorKind: AuthorKind | undefined,
  target: string,
): DeletedEvent {
  return {
    id: uuidv7(),
    type: "deleted",
    timestamp: new Date().toISOString(),
    ...signedBy(author, authorKind),
    target,
  };
}

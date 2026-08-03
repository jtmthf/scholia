// setReaction use case (ADR-0019, ADR-0032, CONTEXT "Reaction").
//
// A Reaction is an event like everything else: `reacted` to add one, `unreacted`
// to take it back. Neither ever removes the other from the stream — the fold
// takes the later of the two per (Comment, author, emoji), so two people
// reacting and un-reacting concurrently land on the same tally everywhere.
//
// The palette is closed (six emoji), so anything outside it is refused rather
// than stored: a Sidecar that can hold arbitrary emoji is one where the rail has
// to decide what to do with a 🦖 it was never designed to render.

import { v7 as uuidv7 } from "uuid";
import { signedBy } from "./author.js";
import { ConversationError } from "./errors.js";
import { requireComment, requireConversation } from "./guards.js";
import { isReactionEmoji, REACTION_PALETTE } from "./reactions.js";
import type { ConversationRepository } from "./repository.js";
import type { AuthorKind, ReactedEvent, UnreactedEvent } from "./types.js";

export interface SetReactionParams {
  conversationId: string;
  commentId: string;
  emoji: string;
  author: string;
  authorKind?: AuthorKind;
  /**
   * Whether the author should end up reacting. Omit to toggle — which is what a
   * click on a chip means, and what an agent calling this twice should expect.
   */
  on?: boolean;
}

/** Whether the author is reacting after this call. */
export async function setReaction(
  repo: ConversationRepository,
  params: SetReactionParams,
): Promise<boolean> {
  if (!isReactionEmoji(params.emoji)) {
    throw new ConversationError(
      "invalid",
      `${params.emoji} is not one of Scholia's reactions (${REACTION_PALETTE.join(" ")})`,
    );
  }

  const conversation = await requireConversation(repo, params.conversationId);
  const comment = requireComment(conversation, params.commentId);

  if (comment.deleted) {
    throw new ConversationError("not-found", "that Comment has been deleted");
  }

  const reacting =
    comment.reactions.find((r) => r.emoji === params.emoji)?.authors.includes(params.author) ??
    false;
  const on = params.on ?? !reacting;

  // Already in the asked-for state. The fold would ignore a repeat, so the only
  // thing writing one buys is a longer file.
  if (on === reacting) return reacting;

  const event: ReactedEvent | UnreactedEvent = {
    id: uuidv7(),
    type: on ? "reacted" : "unreacted",
    timestamp: new Date().toISOString(),
    ...signedBy(params.author, params.authorKind),
    target: params.commentId,
    emoji: params.emoji,
  };

  await repo.appendEvent(params.conversationId, event);
  return on;
}

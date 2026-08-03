// setResolved use case (ADR-0019, ADR-0032).
//
// Resolving is an event, not a flag, and reopening is its own event rather than
// a retraction of the first. That is what lets a Sidecar be merged: both sides'
// documents survive, and the fold takes the later one (CONTEXT "Conversation").
//
// Anyone may resolve or reopen — a Conversation is settled by whoever can see it
// is settled, and the event records who that was, so nothing is anonymous.
// A resolved Conversation collapses in the rail; it is never deleted.

import { v7 as uuidv7 } from "uuid";
import { signedBy } from "./author.js";
import { requireConversation } from "./guards.js";
import type { ConversationRepository } from "./repository.js";
import type { AuthorKind, ReopenedEvent, ResolvedEvent } from "./types.js";

export interface SetResolvedParams {
  conversationId: string;
  resolved: boolean;
  author: string;
  authorKind?: AuthorKind;
}

export async function setResolved(
  repo: ConversationRepository,
  params: SetResolvedParams,
): Promise<void> {
  const conversation = await requireConversation(repo, params.conversationId);

  // Already in the asked-for state. Writing the event anyway would fold to the
  // same thing while reassigning `resolvedBy` to whoever clicked last, which is
  // a quiet lie about who settled it.
  if (conversation.resolved === params.resolved) return;

  const event: ResolvedEvent | ReopenedEvent = {
    id: uuidv7(),
    type: params.resolved ? "resolved" : "reopened",
    timestamp: new Date().toISOString(),
    ...signedBy(params.author, params.authorKind),
  };

  await repo.appendEvent(params.conversationId, event);
}

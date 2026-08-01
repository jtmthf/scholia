// listConversations use case (ADR-0018, ADR-0020).
// Application-layer query: lists all Conversations attached to a Page.

import type { ConversationRepository } from "./repository.js";
import type { Conversation } from "./types.js";

/**
 * List the Conversations attached to the given Page path.
 *
 * Deleted Conversations are dropped here rather than in the adapter: the store's
 * job is to report what the stream says, and "a tombstoned Conversation is no
 * longer on the Page" is a domain rule (ADR-0032). The file itself stays where
 * it is — nothing was removed, only folded away.
 */
export async function listConversations(
  repo: ConversationRepository,
  pagePath: string,
): Promise<Conversation[]> {
  const conversations = await repo.listConversations(pagePath);
  return conversations.filter((conversation) => !conversation.deleted);
}

// listConversations use case (ADR-0018, ADR-0020).
// Application-layer query: lists all Conversations attached to a Page.

import type { ConversationRepository } from "./repository.js";
import type { Conversation } from "./types.js";

/**
 * List all Conversations attached to the given Page path.
 */
export async function listConversations(
  repo: ConversationRepository,
  pagePath: string,
): Promise<Conversation[]> {
  return repo.listConversations(pagePath);
}

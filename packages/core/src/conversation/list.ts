// listConversations use case (ADR-0018, ADR-0020).
// Application-layer query: the Conversations on a Page, or across every Page,
// narrowed by the filters both agent surfaces carry (ADR-0021).

import { mentionsMatch, parseMentions } from "../util/mentions.js";
import type { ConversationRepository } from "./repository.js";
import type { Conversation, Visibility } from "./types.js";

/**
 * What narrows a listing.
 *
 * The same three filters an agent gets over MCP and on the CLI. They are
 * applied here, over the fold, rather than in the adapter: what "unresolved"
 * and "mentions Jane" mean is a domain question, and the Sidecar's job is to
 * report what the streams say.
 */
export interface ConversationFilter {
  /** Page path. Omitted lists every Page. */
  pagePath?: string;
  /** Only Threads, or only Chats. Omitted returns both. */
  visibility?: Visibility;
  /** Only Conversations nobody has resolved. */
  unresolved?: boolean;
  /**
   * ISO 8601. Only Conversations with a Comment written or edited after it —
   * the filter an agent polls with, so an edit to an old Comment counts as
   * activity the same way a reply does.
   */
  since?: string;
  /** Only Conversations whose Comments @-mention this identity. */
  mentions?: string;
}

/** Whether any live Comment was written or edited after `since`. */
function activeSince(conversation: Conversation, since: string): boolean {
  return conversation.comments.some(
    (comment) =>
      comment.timestamp > since || (comment.editedAt !== null && comment.editedAt > since),
  );
}

/** Whether any live Comment addresses `name` (CONTEXT "Mention"). */
function addresses(conversation: Conversation, name: string): boolean {
  return conversation.comments.some(
    (comment) =>
      !comment.deleted && parseMentions(comment.body).some((target) => mentionsMatch(target, name)),
  );
}

/**
 * List Conversations, folded and filtered.
 *
 * Deleted Conversations are dropped here rather than in the adapter: the store's
 * job is to report what the stream says, and "a tombstoned Conversation is no
 * longer on the Page" is a domain rule (ADR-0032). The file itself stays where
 * it is — nothing was removed, only folded away.
 */
export async function listConversations(
  repo: ConversationRepository,
  filter: ConversationFilter | string = {},
): Promise<Conversation[]> {
  // A bare page path is the common call and reads better at the call sites that
  // only ever want one Page (the Local Preview server asks per request).
  const criteria: ConversationFilter = typeof filter === "string" ? { pagePath: filter } : filter;

  const conversations = await repo.listConversations(criteria.pagePath);

  return conversations.filter((conversation) => {
    if (conversation.deleted) return false;
    if (criteria.visibility && conversation.visibility !== criteria.visibility) return false;
    if (criteria.unresolved && conversation.resolved) return false;
    if (criteria.since && !activeSince(conversation, criteria.since)) return false;
    if (criteria.mentions && !addresses(conversation, criteria.mentions)) return false;
    return true;
  });
}

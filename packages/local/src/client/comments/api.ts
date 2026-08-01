// The browser half of Local Preview's Conversation routes.
//
// Every call answers with the Page's full Conversation list, so the caller never
// has to merge a mutation into what it already had — which is the `CommentsPort`
// contract in ADR-0030: a method resolves when the props the components render
// from reflect the change.
//
// Writes only, deliberately. The Conversations a Page starts with are rendered
// into it by the server (ADR-0031); fetching them back would be asking the same
// question twice and risking a different answer.

import type { ConversationDTO } from "@scholia/ui";
import type { SelectionCandidate } from "@scholia/bridge";

interface ConversationsResponse {
  conversations?: ConversationDTO[];
  error?: string;
}

async function send(url: string, init?: RequestInit): Promise<ConversationDTO[]> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as ConversationsResponse;
  // The server's `error` is written to be shown to a reader; the components
  // render whatever a rejection carries (ADR-0030).
  if (!res.ok) throw new Error(data.error ?? "Scholia could not save that comment.");
  return data.conversations ?? [];
}

function post(url: string, body: unknown): Promise<ConversationDTO[]> {
  return send(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function createConversation(input: {
  pagePath: string;
  body: string;
  /** null for a Page-level Conversation — the absence of a selection. */
  selection: SelectionCandidate | null;
  contentHash: string;
}): Promise<ConversationDTO[]> {
  return post("/__conversations", {
    page: input.pagePath,
    body: input.body,
    selection: input.selection,
    contentHash: input.contentHash,
  });
}

export function addComment(input: {
  pagePath: string;
  conversationId: string;
  body: string;
}): Promise<ConversationDTO[]> {
  return post(`/__conversations/${encodeURIComponent(input.conversationId)}/comments`, {
    page: input.pagePath,
    body: input.body,
  });
}

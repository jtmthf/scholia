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
  /** "private" starts a Chat; anything else a public Thread (CONTEXT "Chat"). */
  visibility: "public" | "private";
}): Promise<ConversationDTO[]> {
  return post("/__conversations", {
    page: input.pagePath,
    body: input.body,
    selection: input.selection,
    contentHash: input.contentHash,
    visibility: input.visibility,
  });
}

/**
 * Promote a Chat: write its chosen messages into a new public Thread.
 *
 * The Chat is untouched, so the answer carries both — the new Thread and the
 * Chat that is still there (CONTEXT "Promotion").
 */
export function promote(input: {
  pagePath: string;
  conversationId: string;
  commentIds: string[];
  summary?: string;
}): Promise<ConversationDTO[]> {
  return post(conversationUrl(input.conversationId, "promote"), {
    page: input.pagePath,
    commentIds: input.commentIds,
    ...(input.summary ? { summary: input.summary } : {}),
  });
}

export function addComment(input: {
  pagePath: string;
  conversationId: string;
  body: string;
}): Promise<ConversationDTO[]> {
  return post(conversationUrl(input.conversationId, "comments"), {
    page: input.pagePath,
    body: input.body,
  });
}

// The rest of the verb set (ADR-0032). Every one is a POST with the action in
// the path: the server guards writes with one same-origin POST check, and a
// DELETE or a PATCH would be a second shape to get right for no gain.

export function setResolved(input: {
  pagePath: string;
  conversationId: string;
  resolved: boolean;
}): Promise<ConversationDTO[]> {
  return post(conversationUrl(input.conversationId, "resolve"), {
    page: input.pagePath,
    resolved: input.resolved,
  });
}

export function editComment(input: {
  pagePath: string;
  conversationId: string;
  commentId: string;
  body: string;
}): Promise<ConversationDTO[]> {
  return post(commentUrl(input.conversationId, input.commentId, "edit"), {
    page: input.pagePath,
    body: input.body,
  });
}

export function deleteComment(input: {
  pagePath: string;
  conversationId: string;
  commentId: string;
}): Promise<ConversationDTO[]> {
  return post(commentUrl(input.conversationId, input.commentId, "delete"), {
    page: input.pagePath,
  });
}

export function toggleReaction(input: {
  pagePath: string;
  conversationId: string;
  commentId: string;
  emoji: string;
}): Promise<ConversationDTO[]> {
  return post(commentUrl(input.conversationId, input.commentId, "reactions"), {
    page: input.pagePath,
    emoji: input.emoji,
  });
}

export function deleteConversation(input: {
  pagePath: string;
  conversationId: string;
}): Promise<ConversationDTO[]> {
  return post(conversationUrl(input.conversationId, "delete"), { page: input.pagePath });
}

function conversationUrl(conversationId: string, action: string): string {
  return `/__conversations/${encodeURIComponent(conversationId)}/${action}`;
}

function commentUrl(conversationId: string, commentId: string, action: string): string {
  return `${conversationUrl(conversationId, "comments")}/${encodeURIComponent(commentId)}/${action}`;
}

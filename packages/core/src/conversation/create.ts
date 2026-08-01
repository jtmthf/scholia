// createConversation use case (ADR-0018, ADR-0020).
// Application-layer command: creates a new Conversation with its first Comment.
// Generates UUIDv7 ids per ADR-0019 — ids move from the database to the application.

import { v7 as uuidv7 } from "uuid";
import type { ConversationRepository } from "./repository.js";
import type { Conversation, ConversationHeader, CommentEvent } from "./types.js";
import type { Anchor } from "../anchor/types.js";

export interface CreateConversationParams {
  pagePath: string;
  body: string;
  anchor: Anchor | null;
  author: string;
}

/**
 * Create a new Conversation with its first Comment.
 *
 * Generates application-assigned UUIDv7 ids for the Conversation and Comment
 * (ADR-0019), then delegates to the repository for persistence.
 */
export async function createConversation(
  repo: ConversationRepository,
  params: CreateConversationParams,
): Promise<Conversation> {
  const now = new Date().toISOString();
  const conversationId = uuidv7();
  const commentId = uuidv7();

  const header: ConversationHeader = {
    id: conversationId,
    page: params.pagePath,
    anchor: params.anchor,
    author: params.author,
    timestamp: now,
  };

  const firstComment: CommentEvent = {
    id: commentId,
    type: "comment",
    timestamp: now,
    author: params.author,
    body: params.body,
  };

  return repo.createConversation({ header, firstComment });
}

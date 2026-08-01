// Conversation domain module (ADR-0018, ADR-0019, ADR-0020).
// Port, types and use cases — pure domain, no HTTP / db.

export type {
  ConversationId,
  CommentId,
  ConversationHeader,
  CommentEvent,
  Comment,
  Conversation,
} from "./types.js";

export type { ConversationRepository, CreateConversationInput } from "./repository.js";

export { createConversation, type CreateConversationParams } from "./create.js";
export { listConversations } from "./list.js";

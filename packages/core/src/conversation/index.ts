// Conversation domain module (ADR-0018, ADR-0019, ADR-0020, ADR-0032).
// Port, types, the fold and the use cases — pure domain, no HTTP / db.

export type {
  ConversationId,
  CommentId,
  Visibility,
  AuthorKind,
  ConversationHeader,
  CommentEvent,
  EditedEvent,
  DeletedEvent,
  ReactedEvent,
  UnreactedEvent,
  ResolvedEvent,
  ReopenedEvent,
  ConversationEvent,
  Reaction,
  Comment,
  Conversation,
} from "./types.js";

export type { ConversationRepository, CreateConversationInput } from "./repository.js";

export { REACTION_PALETTE, isReactionEmoji, type ReactionEmoji } from "./reactions.js";
export { ConversationError, type ConversationErrorCode } from "./errors.js";
export { foldConversation } from "./fold.js";

export { createConversation, type CreateConversationParams } from "./create.js";
export { appendComment, type AppendCommentParams } from "./append.js";
export { listConversations } from "./list.js";
export { editComment, type EditCommentParams } from "./edit.js";
export {
  deleteComment,
  deleteConversation,
  type DeleteCommentParams,
  type DeleteConversationParams,
} from "./delete.js";
export { setReaction, type SetReactionParams } from "./react.js";
export { setResolved, type SetResolvedParams } from "./resolve.js";
export { promoteConversation, type PromoteConversationParams } from "./promote.js";

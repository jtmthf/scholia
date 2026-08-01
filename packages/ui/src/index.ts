// The comment layer, shared by every surface that hosts Conversations: the hosted
// viewer (@scholia/web) and Local Preview (@scholia/local). Preact and nothing else
// — no bundler, no server, no HTTP client — so a consumer that isn't a Vite app can
// use it (see ADR-0030). Consumers supply the data as props, the behaviour as a
// CommentsPort, and the stylesheet by importing "@scholia/ui/comments.css" however
// their build wants it.

export { Rail, type OutdatedOrigin } from "./Rail.js";
export { ConversationCard } from "./ConversationCard.js";
export { Comment } from "./Comment.js";
export { Composer } from "./Composer.js";
export { Reactions } from "./Reactions.js";
export { IdentityDisplay } from "./Identity.js";
export { PromoteDialog } from "./PromoteDialog.js";
export { CommentsProvider, useComments, type CommentsPort } from "./port.js";
export {
  REACTION_PALETTE,
  type Anchor,
  type CommentDTO,
  type ConversationDTO,
  type Identity,
  type ReactionGroup,
  type TextQuote,
} from "./types.js";

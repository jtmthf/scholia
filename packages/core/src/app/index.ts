// The application layer (ADR-0020): the command and query set every inbound
// adapter renders, and nothing else. Pure — it names a `ConversationApi` and
// leaves both implementing it to the adapters (@scholia/sidecar in-process,
// @scholia/client over HTTP).

export type {
  ActingAs,
  CommentInput,
  CommentRefInput,
  ConversationApi,
  ConversationRefInput,
  DeletedResult,
  EditCommentInput,
  ListInput,
  PromoteInput,
  ReactInput,
  ReactionResult,
  ReplyInput,
  ResolvedResult,
} from "./api.js";

export {
  toConversationView,
  type CommentView,
  type ConversationView,
  type ReactionView,
  type PromotionView,
} from "./view.js";

export {
  bool,
  list,
  optStr,
  readInput,
  readParam,
  str,
  toFlagName,
  VerbInputError,
  type VerbInput,
  type VerbParam,
  type VerbParamCli,
  type VerbParamType,
} from "./params.js";

export {
  findVerb,
  findVerbByCommand,
  VERBS,
  verbPositionals,
  verbSignature,
  type Verb,
  type VerbOutcome,
  type VerbTargetNotes,
  type VerbTier,
} from "./verbs.js";

// The agent docs an instance serves, rendered from the registry above (#35).
export {
  renderAgentDocs,
  renderAgentDocsHtml,
  type AgentDocsInstance,
  type DocsTarget,
} from "./docs.js";

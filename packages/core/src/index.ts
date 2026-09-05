// @scholia/core — pure domain logic shared by Local Preview and hosting:
// render, Nav, search, Entry Page precedence, content-addressed blobs.
// No HTTP, no db.

// Render
export { renderMarkdown } from "./render/markdown.js";
export { renderMdx } from "./render/mdx.js";
export { getHighlighter, SHIKI_THEMES, SHIKI_OPTIONS } from "./render/pipeline.js";

// Nav / ingest
export { scanTree, type ScanResult } from "./nav/tree.js";
// Hosted Nav + Entry Page from a stored manifest (pure — no filesystem).
export { buildNav, pickEntryPath, type ManifestEntry } from "./nav/manifest.js";
// Serve-time inter-Page link rewriting for hosted Markdown Pages.
export { rewriteInterPageLinks, type RewriteLinkOptions } from "./ingest/links.js";

// Markdown Page ingest for hosting: render + Source Map + content-addressed store.
export { ingestMarkdown, type MarkdownIngest } from "./ingest/markdown.js";
// HTML Page ingest for hosting: parse5 + Source Map + content-addressed store (M4).
export { ingestHtml, readHtmlMeta, type HtmlIngest } from "./ingest/html.js";
export {
  storeMarkdownPage,
  storeHtmlPage,
  type StoredPage,
  type StoredMarkdownPage,
} from "./ingest/store.js";
export {
  SOURCE_MAP_VERSION,
  SOURCE_MAP_ATTR,
  type SourceMap,
  type SourceMapEntry,
} from "./ingest/source-map.js";

// Anchoring (M5): text-quote primary, source-range secondary (ADR-0002).
export {
  searchQuote,
  mapSmIdsToSourceRange,
  migrateAnchor,
  type TextQuote,
  type SourceRange,
  type Anchor,
  type SelectionCandidate,
  type AnchorStatus,
  type MatchKind,
  type MigrationResult,
} from "./anchor/index.js";

// Rendered-text extraction: the string cross-Version migration matches against (M6).
export { renderedText } from "./ingest/rendered-text.js";
export { markdownText } from "./ingest/markdown-text.js";

// Source-level line diff between two Versions of a Page (M6, CONTEXT "Diff").
export { diffLines, type DiffLine, type DiffLineType, type LineDiff } from "./diff/lines.js";

// Search
export { createSearchIndex, type SearchIndex, type SearchHit } from "./search/index.js";

// Utils
export { parseFrontmatter, type Frontmatter } from "./util/frontmatter.js";
export { extractHeadings } from "./util/headings.js";
export { contentType } from "./util/mime.js";
export { classifyFile, isDoc, isMdx, toUrlPath, resolveWithinRoot } from "./util/paths.js";
export { toText, escapeHtml, humanize, htmlToDerivedText, acceptsMarkdown } from "./util/text.js";
// Best-effort git facts (CONTEXT "Provenance", ADR-0007) — shared by
// @scholia/cli (frozen at upload) and @scholia/local (read live for the
// Colophon).
export { getProvenance, type Provenance } from "./util/provenance.js";
// @-mention parsing + matching for the agent routing filter (M7, CONTEXT "Mention").
export { parseMentions, mentionsMatch } from "./util/mentions.js";
// Safe regex wrappers with input-length guards against polynomial ReDoS (ADR-0032).
export {
  MAX_REGEX_INPUT,
  guardRegexInput,
  safeTest,
  safeExec,
  safeMatch,
  safeReplace,
  safeSplit,
} from "./util/safe-regex.js";

// Types
export type { Heading, NavNode, DocRecord, RenderResult } from "./types.js";

export {
  CONTENT_HASH_ALGO,
  hashBytes,
  FsBlobStore,
  S3BlobStore,
  isValidHash,
  shardedKey,
} from "./blob/index.js";
export type { BlobRef, BlobStore, PutResult, S3BlobStoreConfig } from "./blob/index.js";

// MirrorProvider port + outbound domain events (M10, ADR-0008). Pure domain
// shape; @scholia/github is the v1 impl, server is where HTTP + db meet it.
export { isGitHubMirror } from "./mirror/index.js";
export type {
  MirrorIdentity,
  MirrorProvenance,
  MirrorBinding,
  ContentSourceFetch,
  FetchedFile,
  FetchResult,
  MirrorEventBase,
  CommentMirrorEvent,
  ResolveMirrorEvent,
  PromotionMirrorEvent,
  MirrorEvent,
  MirrorContext,
  MirrorTopic,
  MirrorProvider,
} from "./mirror/index.js";

// Conversation port + use cases (ADR-0018, ADR-0019, ADR-0020).
// ConversationRepository port, domain types, createConversation and
// listConversations use cases. Pure domain — no HTTP, no db.
export {
  REACTION_PALETTE,
  isReactionEmoji,
  ConversationError,
  foldConversation,
  createConversation,
  appendComment,
  listConversations,
  editComment,
  deleteComment,
  deleteConversation,
  setReaction,
  setResolved,
  promoteConversation,
} from "./conversation/index.js";
export type {
  ConversationId,
  CommentId,
  Visibility,
  AuthorKind,
  Identity,
  ConversationHeader,
  CommentEvent,
  EditedEvent,
  DeletedEvent,
  ReactedEvent,
  UnreactedEvent,
  ResolvedEvent,
  ReopenedEvent,
  PromotedEvent,
  ConversationEvent,
  Reaction,
  Comment,
  Conversation,
  PromotionRecord,
  ConversationRepository,
  CreateConversationInput,
  ReactionEmoji,
  ConversationErrorCode,
  CreateConversationParams,
  AppendCommentParams,
  ConversationFilter,
  EditCommentParams,
  DeleteCommentParams,
  DeleteConversationParams,
  SetReactionParams,
  SetResolvedParams,
  PromoteConversationParams,
} from "./conversation/index.js";

// The application layer's command and query set (ADR-0020) and the verb
// registry every inbound adapter renders (ADR-0021).
export {
  toConversationView,
  bool,
  list,
  optStr,
  readInput,
  readParam,
  str,
  toFlagName,
  VerbInputError,
  findVerb,
  findVerbByCommand,
  VERBS,
  verbPositionals,
  verbSignature,
  renderAgentDocs,
  renderAgentDocsHtml,
} from "./app/index.js";
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
  CommentView,
  ConversationView,
  ReactionView,
  PromotionView,
  VerbInput,
  VerbParam,
  VerbParamCli,
  VerbParamType,
  Verb,
  VerbOutcome,
  VerbTargetNotes,
  VerbTier,
  AgentDocsInstance,
  DocsTarget,
} from "./app/index.js";

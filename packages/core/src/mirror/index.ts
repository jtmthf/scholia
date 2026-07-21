// MirrorProvider port + outbound domain events (M10, ADR-0008). Pure domain
// shape; no HTTP/db. See provider.ts.
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
} from "./provider.js";
export { isGitHubMirror } from "./provider.js";
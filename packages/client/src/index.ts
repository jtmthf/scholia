export { collectFiles, type CollectedFile } from "./collect.js";
export {
  loadCredentials,
  saveCredential,
  removeCredential,
  credentialsPath,
  type SiteCredential,
  type CredentialStore,
} from "./credentials.js";
export {
  ScholiaClient,
  resolveCredential,
  type ScholiaClientOptions,
  type SiteCreatedResult,
  type VersionAddedResult,
  type Provenance,
  type FileManifestEntry,
  type Anchor,
  type TextQuote,
  type ListCommentsFilter,
  type ListChatsFilter,
  type SiteCommentDTO,
  type ListCommentsResult,
  type CreateThreadOptions,
  type CreateChatOptions,
  type ReplyOptions,
  type ReactOptions,
  type ResolveOptions,
  type DeleteCommentOptions,
  type EditCommentOptions,
  type PromoteOptions,
  type DiffOptions,
  type SiteState,
  type TokenSummary,
} from "./client.js";
// The remote target for the agent verb set: the same application interface,
// over HTTP (ADR-0020).
export { createRemoteApi, type RemoteApiOptions } from "./remote-api.js";

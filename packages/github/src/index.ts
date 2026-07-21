// @collab/github — the GitHub `MirrorProvider` (ADR-0008/0009). App-installation
// authed REST/GraphQL client (no clone/push, no stored PATs), webhook parsing,
// and PR/ref byte fetch. The `GitHubMirrorProvider` (outbound dispatch + reconcile)
// lives in provider.ts; everything here is the surface it builds on.

export {
  base64url,
  mintAppJwt,
  decodeJwtPayload,
  InstallationTokenCache,
  type InstallationToken,
} from "./auth.js";

export {
  GitHubApiError,
  HttpGitHubApi,
  FakeGitHubApi,
  type GitHubApi,
  type RepoPath,
  type PrHead,
  type PullRequestInfo,
  type PrFile,
  type PrReviewComment,
  type CreatedComment,
  type CreateReviewCommentInput,
  type ReviewThread,
  type FakeRepoState,
  type HttpGitHubApiOptions,
} from "./rest.js";

export {
  parseWebhook,
  verifySignature,
  WebhookSignatureError,
} from "./webhook.js";

export { fetchPRFiles, fetchRefFiles, parseRepo } from "./fetch.js";

export type {
  InboundEvent,
  InboundReviewComment,
  InboundIssueComment,
  InboundReview,
  InboundLifecycle,
  ReviewState,
  PullRequestState,
} from "./inbound.js";
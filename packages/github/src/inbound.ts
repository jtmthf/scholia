// Normalized inbound GitHub events (ADR-0008 inbound). `webhook.ts` produces these
// from a parsed payload; the reconciliation poll (`MirrorProvider.reconcile`)
// produces the same shapes by re-fetching. The server imports them via the
// importer; this is pure shape — no HTTP.

export type PullRequestState = "open" | "closed";

export interface InboundReviewComment {
  kind: "review_comment";
  repo: string;
  prNumber: number;
  /** GitHub comment database id (REST) — the dedup key on `comment_mirrors.external_id`. */
  externalId: string;
  externalUrl: string;
  /** File path the comment lines up on (null when GitHub cannot place it). */
  path: string | null;
  line: number | null;
  side: "LEFT" | "RIGHT" | null;
  author: { login: string; avatarUrl: string | null };
  body: string;
  /** The commit the comment was made against (PR head or commit being reviewed). */
  commit: string;
  action: "created" | "edited" | "deleted";
}

export interface InboundIssueComment {
  kind: "issue_comment";
  repo: string;
  prNumber: number;
  externalId: string;
  externalUrl: string;
  author: { login: string; avatarUrl: string | null };
  body: string;
  action: "created" | "edited" | "deleted";
}

export type ReviewState =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "COMMENTED"
  | "DISMISSED"
  | "PENDING";

export interface InboundReview {
  kind: "review";
  repo: string;
  prNumber: number;
  externalId: string;
  externalUrl: string;
  author: { login: string; avatarUrl: string | null };
  state: ReviewState;
  body: string;
  /** The head commit the review was submitted against. */
  commit: string;
  action: "submitted" | "dismissed";
}

export interface InboundThreadResolved {
  kind: "thread_resolved";
  repo: string;
  prNumber: number;
  /** externalId of a comment in the thread — maps to `comment_mirrors` to find the Conversation. */
  externalId: string;
  resolved: boolean;
  resolvedBy: string;
}

export interface InboundLifecycle {
  kind: "lifecycle";
  repo: string;
  prNumber: number;
  action:
  | "synchronize"
  | "closed"
  | "reopened"
  | "locked"
  | "unlocked";
  /** New PR head commit (synchronize). Latest provenance.sha dedupe key. */
  headSha?: string;
  branch?: string;
  /** `closed` action — true when the PR was merged. */
  merged?: boolean;
}

export type InboundEvent =
  | InboundReviewComment
  | InboundIssueComment
  | InboundReview
  | InboundThreadResolved
  | InboundLifecycle;
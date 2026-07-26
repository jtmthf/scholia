// The MirrorProvider port (M10, ADR-0008). A PR-backed Site mirrors its PUBLIC
// discussion to/from a native provider comment store (GitHub PR comments in v1).
// Postgres stays authoritative; providers are projections + an optional content
// fetch path. The port lives in `@scholia/core` because it is pure domain shape —
// no HTTP, no db, no provider-specifics. `@scholia/github` is the v1 impl; the
// server is where providers meet HTTP + db.
//
// `MirrorBinding` and `ContentSourceFetch` are re-declared here (rather than
// imported from `@scholia/db`) so `core` stays free of the db package. The db's
// `MirrorBinding`/`ContentSource` jsonb shapes are structurally identical and
// the server bridges between them at the boundary.

import type { Anchor } from "../anchor/types.js";

// ---- Identity (mirrors `@scholia/db` Identity structurally; re-declared for core purity) ----

export interface MirrorIdentity {
  name: string;
  kind: "human" | "agent";
  tier: "owner" | "viewer";
  onBehalfOf?: string;
  source: "native" | "github";
}

// ---- Provenance (mirrors `@scholia/db` Provenance) ----

export interface MirrorProvenance {
  remote?: string;
  sha?: string;
  branch?: string;
  dirty?: boolean;
}

// ---- Site ↔ provider binding ----

export interface MirrorBinding {
  provider: string;
  repo: string;
  prNumber: number;
}

// ---- Content sources (the fetch path; ADR-0009) ----

export type ContentSourceFetch =
  | { kind: "ref"; repo: string; ref: string }
  | { kind: "pr"; repo: string; prNumber: number };

export interface FetchedFile {
  path: string;
  bytes: Uint8Array;
}

export interface FetchResult {
  files: FetchedFile[];
  provenance: MirrorProvenance;
}

// ---- Outbound domain events (server emits these after a DB write) ----

export interface MirrorEventBase {
  siteId: string;
  mirrorBinding: MirrorBinding;
  conversationId: string;
  pagePath: string | null;
  /** The Scholia Version the comment is bound to (CONTEXT "Comment"). */
  createdVersionId: string;
}

export interface CommentMirrorEvent extends MirrorEventBase {
  type: "comment_created";
  commentId: string;
  /** The native Identity named in the bot-authored body (ADR-0008). */
  author: MirrorIdentity;
  body: string;
  /** Source-range used to place the review comment; null for page-level. */
  anchor: Anchor | null;
  /** Outbound only fires for native Scholia comments (`origin === "scholia"`). */
  origin: "scholia";
}

export interface ResolveMirrorEvent extends MirrorEventBase {
  type: "resolve";
  resolved: boolean;
  resolvedBy: string;
}

export interface PromotionMirrorEvent extends MirrorEventBase {
  type: "promotion";
  comments: Array<{
    commentId: string;
    author: MirrorIdentity;
    body: string;
    anchor: Anchor | null;
  }>;
}

export type MirrorEvent =
  | CommentMirrorEvent
  | ResolveMirrorEvent
  | PromotionMirrorEvent;

// ---- Context handed to `dispatch` so a provider can resolve stored bytes ----

export interface MirrorContext {
  /** The version-bound manifest entry for a page path, or null. */
  getManifestEntry(
    versionId: string,
    pagePath: string,
  ): Promise<{
    path: string;
    kind: "markdown" | "html" | "asset";
    contentHash: string;
    renderedHash: string | null;
    sourceMapHash: string | null;
  } | null>;
  /** Fetch the canonical source bytes for a content hash. */
  getSource(contentHash: string): Promise<Uint8Array | null>;
}

// ---- The port ----

export interface MirrorTopic {
  mirrorBinding: MirrorBinding | null;
}

export interface MirrorProvider {
  readonly id: string;
  /** Pure predicate: does this provider handle the binding (PR-backed + GitHub)? */
  appliesTo(topic: MirrorTopic): boolean;
  /** Whether the provider can fetch bytes for a content source (ref/pr). */
  supportsContentSource(cs: ContentSourceFetch): boolean;
  /** Fetch bytes at a ref or PR head (ADR-0009 — read PR files only). */
  fetchContent(cs: ContentSourceFetch): Promise<FetchResult>;
  /** Outbound projection of public-Thread mutations to the provider (ADR-0008). */
  dispatch(events: MirrorEvent[], ctx: MirrorContext): Promise<void>;
}

// ---- Predicate used by the server to gate outbound only for PR-backed GitHub ----

export function isGitHubMirror(binding: MirrorBinding | null): boolean {
  return binding !== null && binding.provider === "github";
}
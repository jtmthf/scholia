import { and, asc, eq, ne } from "drizzle-orm";
import { getMirrorRow, schema, touchMirrorRow } from "./db-helpers.js";
import type { Db } from "@collab/db";
import {
  type ContentSourceFetch,
  type FetchResult,
  type MirrorContext,
  type MirrorEvent,
  type MirrorProvider,
  type MirrorTopic,
} from "@collab/core";
import {
  fetchPRFiles,
  fetchRefFiles,
  parseRepo,
  GitHubApiError,
  type GitHubApi,
  type RepoPath,
  type FakeGitHubApi,
} from "@collab/github";
import type { GitHubOperatorConfig } from "../github-config.js";
import { sourceRangeToLines } from "./line-map.js";

// `AppDepsMirrorCompat` and the `db-helpers.js` indirection keep this file free of
// the dodgy inline `await import("@collab/db")` chains of an earlier draft. The
// helpers re-export @collab/db repo methods + the schema namespace.

export interface GitHubMirrorProviderOptions {
  api: GitHubApi;
  db: Db;
  config: GitHubOperatorConfig;
  /** Test hook: resolve a repo name → installation id (production = db lookup). */
  installationResolver?: (repo: string) => Promise<number | null>;
  /** Test hook: supply a tree-listing for ref sources; production wires a git/trees fetch. */
  listTree?: (api: GitHubApi, repo: RepoPath, ref: string) => Promise<string[]>;
}

export class GitHubMirrorProvider implements MirrorProvider {
  readonly id = "github";
  private readonly api: GitHubApi;
  private readonly db: Db;
  private readonly config: GitHubOperatorConfig;
  private readonly installationResolver: (repo: string) => Promise<number | null>;
  private readonly listTree: (api: GitHubApi, repo: RepoPath, ref: string) => Promise<string[]>;

  constructor(opts: GitHubMirrorProviderOptions) {
    this.api = opts.api;
    this.db = opts.db;
    this.config = opts.config;
    this.installationResolver = opts.installationResolver ?? (() => Promise.resolve(null));
    this.listTree = opts.listTree ?? defaultListTree;
  }

  appliesTo(topic: MirrorTopic): boolean {
    return topic.mirrorBinding !== null && topic.mirrorBinding.provider === "github";
  }

  supportsContentSource(cs: ContentSourceFetch): boolean {
    return cs.kind === "ref" || cs.kind === "pr";
  }

  async fetchContent(cs: ContentSourceFetch): Promise<FetchResult> {
    if (cs.kind === "pr") return fetchPRFiles(this.api, cs.repo, cs.prNumber);
    return fetchRefFiles(this.api, cs.repo, cs.ref, { listTree: this.listTree });
  }

  async dispatch(events: MirrorEvent[], ctx: MirrorContext): Promise<void> {
    for (const event of events) {
      if (event.type === "comment_created") {
        await this.dispatchComment(event, ctx);
      } else if (event.type === "resolve") {
        await this.dispatchResolve(event, ctx);
      } else if (event.type === "promotion") {
        for (const c of event.comments) {
          const single = {
            ...event,
            type: "comment_created" as const,
            commentId: c.commentId,
            author: c.author,
            body: c.body,
            anchor: c.anchor,
            origin: "collab" as const,
          };
          await this.dispatchComment(single, ctx);
        }
      }
    }
  }

  // ---- outbound: a single public comment ----

  private async dispatchComment(
    event: Extract<MirrorEvent, { type: "comment_created" }>,
    ctx: MirrorContext,
  ): Promise<void> {
    const existing = await getMirrorRow(this.db, event.commentId, "github");
    if (existing?.status === "synced") return; // dedup

    const repo = parseRepo(event.mirrorBinding.repo);
    const binding = event.mirrorBinding;
    const body = botBody(event.author, event.body);
    const pr = await this.api.getPullRequest(repo, binding.prNumber);
    const commitId = pr.head.sha;

    let line: number | null = null;
    let path: string | null = null;
    if (event.pagePath && event.anchor?.sourceRange) {
      const entry = await ctx.getManifestEntry(event.createdVersionId, event.pagePath);
      if (entry) {
        const src = await ctx.getSource(entry.contentHash);
        if (src) {
          const lines = sourceRangeToLines(src, event.anchor.sourceRange);
          line = lines.endLine;
          path = event.pagePath;
        }
      }
    }

    // A reply to an existing public Thread shares the thread's anchor (same
    // path/line as the root), so it would otherwise post as a second, disconnected
    // top-level review comment. Thread it under the root via `inReplyTo` when a
    // prior synced comment exists in this conversation.
    const replyToExternalId = await findThreadRootExternalId(this.db, event.conversationId, event.commentId);

    let externalId: string;
    let externalUrl: string | null = null;
    if (path && line !== null) {
      try {
        const created = await this.api.createPrReviewComment(repo, binding.prNumber, {
          body,
          commitId,
          path,
          line,
          side: "RIGHT",
          ...(replyToExternalId ? { inReplyTo: Number(replyToExternalId) } : {}),
        });
        externalId = String(created.id);
        externalUrl = created.url;
      } catch (err) {
        if (!isOutOfDiffError(err)) throw err; // transient (timeout/5xx/rate-limit): let the bus retry the POST itself
        // Out-of-diff (422) degrades to a file-level issue comment quoting the text.
        const quoted = botFileLevelBody(event.author, event.body, event.anchor);
        const created = await this.api.createIssueComment(repo, binding.prNumber, quoted);
        externalId = String(created.id);
        externalUrl = created.url;
      }
    } else {
      const quoted = botFileLevelBody(event.author, event.body, event.anchor);
      const created = await this.api.createIssueComment(repo, binding.prNumber, quoted);
      externalId = String(created.id);
      externalUrl = created.url;
    }

    // The comment now exists on GitHub — from here on we must NOT let an error
    // escape and trigger the bus's outer retry, or it will re-POST a duplicate
    // comment. Retry the DB write internally; if it still fails, swallow rather
    // than throw. dispatchOne's own success-path fallback will then mark the row
    // synced (without the external id/url) rather than re-dispatching.
    await writeSyncedWithRetry(this.db, {
      commentId: event.commentId,
      provider: "github",
      externalId,
      externalUrl,
      status: "synced",
    });
  }

  private async dispatchResolve(
    event: Extract<MirrorEvent, { type: "resolve" }>,
    _ctx: MirrorContext,
  ): Promise<void> {
    // Find an already-synced comment in this conversation and resolve its thread.
    const rows = await this.db
      .select({
        commentId: schema.commentMirrors.commentId,
        externalId: schema.commentMirrors.externalId,
        status: schema.commentMirrors.status,
      })
      .from(schema.commentMirrors)
      .innerJoin(
        schema.comments,
        eq(schema.commentMirrors.commentId, schema.comments.id),
      )
      .where(eq(schema.comments.conversationId, event.conversationId))
      .limit(50);
    for (const r of rows) {
      if (r.status !== "synced") continue;
      const repo = parseRepo(event.mirrorBinding.repo);
      const threads = await this.api.listReviewThreads(repo, event.mirrorBinding.prNumber);
      const thread = threads.find((t) =>
        t.comments.some((c) => String(c.databaseId) === r.externalId),
      );
      if (thread) {
        try {
          await this.api.resolveReviewThread(thread.id, event.resolved);
        } catch {
          // best-effort; reconcile poll will re-sync resolve state from GitHub.
        }
        return;
      }
    }
  }
}

// Find the externalId to thread a reply under. GitHub's `in_reply_to` must name
// the review thread's top-level comment, so this is the EARLIEST synced mirror
// row in the conversation (excluding the reply's own row, which the bus already
// pre-wrote as "pending"). Returns null for the thread root itself (no earlier
// row) or an unsynced/unmirrored conversation — the caller then posts fresh.
async function findThreadRootExternalId(
  db: Db,
  conversationId: string,
  ownCommentId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ externalId: schema.commentMirrors.externalId })
    .from(schema.commentMirrors)
    .innerJoin(schema.comments, eq(schema.commentMirrors.commentId, schema.comments.id))
    .where(
      and(
        eq(schema.comments.conversationId, conversationId),
        eq(schema.commentMirrors.status, "synced"),
        ne(schema.commentMirrors.commentId, ownCommentId),
      ),
    )
    .orderBy(asc(schema.comments.createdAt))
    .limit(1);
  return row?.externalId || null;
}

// A createPrReviewComment call fails with a 422 when the target line isn't part
// of the diff — that's the one case we degrade to a file-level comment for. Any
// other error (timeout, 5xx, secondary rate-limit) must propagate so the bus
// retries the POST itself, instead of silently and permanently discarding the
// line anchor.
function isOutOfDiffError(err: unknown): boolean {
  return err instanceof GitHubApiError && err.status === 422;
}

// Retry the post-POST DB write a few times before giving up. Never throws: once
// the GitHub comment exists, an error here must not propagate to the bus's retry
// loop, which would re-run dispatch and re-POST a duplicate comment. If every
// attempt fails, dispatchOne's own success-path fallback marks the row synced
// (without the external id/url) rather than re-dispatching.
async function writeSyncedWithRetry(
  db: Db,
  input: Parameters<typeof touchMirrorRow>[1],
  attempts = 3,
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await touchMirrorRow(db, input);
      return;
    } catch (err) {
      if (attempt === attempts) {
        console.error(
          `[collab] mirror: failed to record synced comment_mirrors row for ${input.commentId} after ${attempts} attempts — GitHub comment ${input.externalId} was created but is not linked in the DB:`,
          err,
        );
        return;
      }
      await new Promise((r) => setTimeout(r, 50 * attempt));
    }
  }
}

// ---- bot body ----

const BOT_PREFIX = "(via Collab)";

export function botBody(
  author: { name: string; kind: string; onBehalfOf?: string },
  body: string,
): string {
  const who =
    author.kind === "agent"
      ? `${author.name}${author.onBehalfOf ? ` (on behalf of ${author.onBehalfOf})` : ""}`
      : author.name;
  return `**${who}** ${BOT_PREFIX}\n\n${body}`;
}

export function botFileLevelBody(
  author: { name: string; kind: string; onBehalfOf?: string },
  body: string,
  anchor: { textQuote?: { exact: string; prefix?: string; suffix?: string } } | null,
): string {
  const head = botBody(author, body);
  const quote = anchor?.textQuote?.exact;
  return quote ? `${head}\n\n> ${quote}` : head;
}

// ref-source tree listing stub; production wires a real git/trees REST call here.
async function defaultListTree(_api: GitHubApi, _repo: RepoPath, _ref: string): Promise<string[]> {
  throw new Error("ref tree listing not configured — supply a listTree override");
}

export type { FakeGitHubApi };
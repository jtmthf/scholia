// Inbound importer (ADR-0008): turn normalized `InboundEvent`s into Collab
// Conversations + Comments + `comment_mirrors` rows. DB stays authoritative;
// the importer emits NO outbound event (origin is github — read-only on Collab
// side, ADR origin-owns). Each event is processed in its own transaction to
// avoid half-imported state.

import type { Db } from "@collab/db";
import {
  createConversation,
  addComment,
  tombstoneComment,
  detachMirror,
  mirrorExistsByExternal,
  getMirrorWithOrigins,
  findPRBackedSites,
  getLatestVersionId,
  setResolved,
  type Identity,
} from "@collab/db";
import type { BlobStore, Anchor, TextQuote } from "@collab/core";
import { schema } from "@collab/db";
import { and, eq } from "drizzle-orm";
import type { InboundEvent } from "@collab/github";

export interface ImporterDeps {
  db: Db;
  store: BlobStore;
  /**
   * The GitHub App's own bot login (e.g. "collab-bot[bot]"), when GitHub is
   * configured. Comments authored by the bot are never imported — without this
   * backstop, a fast webhook redelivery of our own outbound comment (arriving
   * before its comment_mirrors row is marked synced) would echo back in as a
   * new inbound Thread.
   */
  botLogin?: string | null;
}

// Process a batch of inbound events. Returns the number of events that resulted
// in a state change (created/tombstoned/detached). Skips no-ops (dedup, unsupported).
export async function importInbound(events: InboundEvent[], deps: ImporterDeps): Promise<number> {
  let processed = 0;
  for (const event of events) {
    const changed = await importOne(event, deps);
    if (changed) processed++;
  }
  return processed;
}

async function importOne(event: InboundEvent, deps: ImporterDeps): Promise<boolean> {
  switch (event.kind) {
    case "review_comment":
      return importReviewComment(event, deps);
    case "issue_comment":
      return importIssueComment(event, deps);
    case "review":
      return importReview(event, deps);
    case "thread_resolved":
      return importThreadResolved(event, deps);
    case "lifecycle":
      // Lifecycle events are routed to the lifecycle handler (Sub-Task 8).
      // The importer itself doesn't create comments for these — it's a
      // signaling side channel for Site state changes. The webhook route
      // calls handleLifecycle directly (lifecycle needs the provider for
      // re-fetch and to mutate site state directly).
      return false;
    default:
      return false;
  }
}

// ---- review_comment ----

async function importReviewComment(
  event: Extract<InboundEvent, { kind: "review_comment" }>,
  deps: ImporterDeps,
): Promise<boolean> {
  if (event.action === "created") return importCreatedComment(event, deps, "review");
  if (event.action === "deleted") return handleDeleted(event.repo, event.prNumber, event.externalId, deps);
  // edited: ignore in v1 (DB is authoritative; we don't sync edits inbound)
  return false;
}

// ---- issue_comment ----

async function importIssueComment(
  event: Extract<InboundEvent, { kind: "issue_comment" }>,
  deps: ImporterDeps,
): Promise<boolean> {
  if (event.action === "created") return importCreatedComment(event, deps, "issue");
  if (event.action === "deleted") return handleDeleted(event.repo, event.prNumber, event.externalId, deps);
  return false;
}

// ---- review (submitted/dismissed) ----

async function importReview(
  event: Extract<InboundEvent, { kind: "review" }>,
  deps: ImporterDeps,
): Promise<boolean> {
  if (event.action !== "submitted") return false;
  // v1: lowest-fidelity — treat as a page-level public comment from the reviewer.
  // CHANGES_REQUESTED / DISMISSED are still imported as comments (not modeled as
  // review state beyond the comment body).
  if (!event.body.trim()) return false; // empty review body → skip
  return importCreatedComment(event, deps, "review");
}

// ---- shared: create a Thread from an inbound GitHub comment ----

async function importCreatedComment(
  event:
    | Extract<InboundEvent, { kind: "review_comment" }>
    | Extract<InboundEvent, { kind: "issue_comment" }>
    | Extract<InboundEvent, { kind: "review" }>,
  deps: ImporterDeps,
  source: "review" | "issue",
): Promise<boolean> {
  // Echo-loop backstop: never import a comment authored by our own bot, even if
  // its comment_mirrors row hasn't been marked synced yet (see ImporterDeps.botLogin).
  if (deps.botLogin && event.author.login === deps.botLogin) return false;

  // Fast-path dedup check — skips the common case cheaply. Not sufficient alone:
  // a concurrent import of the same external id (webhook delivery racing the
  // reconcile poll, or a webhook retry) would both pass this check. The real
  // guard is the atomic insert below, backed by the DB's unique
  // (provider, external_id) index — see CreateConversationInput.mirror.
  if (await mirrorExistsByExternal(deps.db, "github", event.externalId)) return false;

  // Find the PR-backed Site(s) for this repo + prNumber.
  const sites = await findPRBackedSites(deps.db, event.repo, event.prNumber);
  if (sites.length === 0) return false;

  let created = false;
  for (const site of sites) {
    // Get the latest Version to bind the comment to.
    const latest = await getLatestVersionId(deps.db, site.id);
    if (!latest) continue;

    // Build an anchor from the line/path (review comments) or null (issue comments).
    const anchor = source === "review" && "path" in event && "line" in event
      ? await lineToAnchor(deps, latest.id, event.path, event.line)
      : null;

    // Use the path from the event for pagePath, or null for page-level.
    const pagePath = "path" in event ? event.path : null;

    const author: Identity = {
      name: event.author.login,
      kind: "human",
      tier: "viewer",
      source: "github",
    };

    try {
      await createConversation(deps.db, {
        siteId: site.id,
        createdVersionId: latest.id,
        pagePath: anchor ? pagePath : null,
        visibility: "public",
        anchor,
        firstComment: {
          versionId: latest.id,
          body: event.body,
          author,
          authorViewerId: null,
          origin: "github",
        },
        // Inserted in the SAME transaction as the Conversation/Comment: a
        // unique-violation here rolls back the whole Thread instead of leaving
        // one behind with no mirror row.
        mirror: {
          provider: "github",
          externalId: event.externalId,
          externalUrl: event.externalUrl,
          status: "synced",
        },
      });
      created = true;
    } catch (err) {
      if (!isExternalIdConflict(err)) throw err;
      // Another concurrent import already claimed this external id — no-op.
    }
  }
  return created;
}

// Detect the comment_mirrors (provider, external_id) unique-violation specifically,
// so an unrelated DB error during import isn't silently swallowed as a dedup no-op.
function isExternalIdConflict(err: unknown): boolean {
  const pgErr = err as { code?: string; constraint_name?: string } | null;
  return pgErr?.code === "23505" && pgErr.constraint_name === "comment_mirrors_external_id_idx";
}

// ---- thread_resolved (native GitHub resolve/unresolve) ----

// GitHub's `pull_request_review_thread` webhook (and the reconcile poll,
// via listReviewThreads) carries the resolved state of a whole thread,
// identified by one of its comments. Maps to the Conversation via that
// comment's comment_mirrors row. No-ops when the DB already agrees (avoids
// stomping a more specific `resolvedBy` on every reconcile poll when nothing
// actually changed) — last-writer-wins otherwise (ADR-0008), same as the
// outbound resolve path: the importer overwrites unconditionally.
async function importThreadResolved(
  event: Extract<InboundEvent, { kind: "thread_resolved" }>,
  deps: ImporterDeps,
): Promise<boolean> {
  const mirror = await getMirrorWithOrigins(deps.db, "github", event.externalId);
  if (!mirror) return false; // unknown comment — no Conversation to resolve

  const [conv] = await deps.db
    .select({ resolvedAt: schema.conversations.resolvedAt })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, mirror.conversationId))
    .limit(1);
  if (!conv) return false;

  const currentlyResolved = conv.resolvedAt !== null;
  if (currentlyResolved === event.resolved) return false; // already in sync

  await setResolved(deps.db, {
    conversationId: mirror.conversationId,
    resolved: event.resolved,
    resolvedBy: event.resolvedBy,
  });
  return true;
}

// ---- shared: handle a deleted GitHub comment ----

async function handleDeleted(
  repo: string,
  prNumber: number,
  externalId: string,
  deps: ImporterDeps,
): Promise<boolean> {
  // Look up the mirror row to determine the origin.
  const mirror = await getMirrorWithOrigins(deps.db, "github", externalId);
  if (!mirror) return false; // unknown comment — nothing to delete

  if (mirror.commentOrigin === "github") {
    // The comment was authored on GitHub → tombstone it in Collab.
    await tombstoneComment(deps.db, mirror.commentId);
  } else {
    // The comment was authored in Collab (our bot pushed it) → detach the mirror.
    // The Collab comment stays intact; we just stop tracking the external link.
    await detachMirror(deps.db, { commentId: mirror.commentId, provider: "github" });
  }
  return true;
}

// ---- line → Anchor helper ----

// Given a Version's Page source and a 1-based line number, build an Anchor with
// a text-quote (exact = the line text, prefix/suffix = neighboring lines for
// uniqueness) and a sourceRange (char offsets). Returns null when the Page
// doesn't exist or the line is out of range → caller falls back to page-level.
async function lineToAnchor(
  deps: ImporterDeps,
  versionId: string,
  pagePath: string | null,
  line: number | null,
): Promise<Anchor | null> {
  if (!pagePath || line === null || line < 1) return null;

  // Resolve the manifest entry for this Page at the Version.
  const [entry] = await deps.db
    .select({
      contentHash: schema.manifestEntries.contentHash,
      kind: schema.manifestEntries.kind,
    })
    .from(schema.manifestEntries)
    .where(
      and(
        eq(schema.manifestEntries.versionId, versionId),
        eq(schema.manifestEntries.path, pagePath),
      ),
    )
    .limit(1);
  if (!entry) return null;

  // Fetch the source bytes.
  const bytes = await deps.store.get(entry.contentHash);
  if (!bytes) return null;

  const text = new TextDecoder().decode(bytes);
  const lines = text.split("\n");
  if (line > lines.length) return null;

  // Build a text-quote: exact = the target line, prefix = previous line, suffix = next line.
  const exact = lines[line - 1]!.trim();
  if (!exact) return null;

  const quote: TextQuote = { exact };
  if (line > 1) {
    const prev = lines[line - 2]!.trim();
    if (prev) quote.prefix = prev;
  }
  if (line < lines.length) {
    const next = lines[line]!.trim();
    if (next) quote.suffix = next;
  }

  // Compute the source range (char offsets) for the line.
  let start = 0;
  for (let i = 0; i < line - 1; i++) start += lines[i]!.length + 1; // +1 for \n
  const end = start + lines[line - 1]!.length;

  return { textQuote: quote, sourceRange: { start, end } };
}

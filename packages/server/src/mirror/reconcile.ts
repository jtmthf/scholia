// Reconciliation poller (ADR-0008): re-fetches PR review comments for every
// PR-backed Site since its stored cursor, feeding them to the importer. This is
// the poll-only fallback for firewalled self-hosts where webhooks aren't
// delivered, and a safety net for dropped webhooks.
//
// `runMirrorDrain` (ADR-0015, M11) pairs this inbound reconcile with the
// outbound mirror bus's pending-row sweep into one platform-agnostic trigger:
// self-host calls it from a `setInterval` started at boot (`startDrainLoop`);
// a hosted target with no persistent process (Vercel) calls it from
// `POST /internal/drain` on a schedule instead. Same function either way — the
// domain logic doesn't know which platform is calling it.

import type { AppDeps } from "../config.js";
import { findPRBackedSites, getGitHubSiteState, setGitHubReconcileCursor, getLatestManifest } from "@collab/db";
import type { InboundEvent } from "@collab/github";
import { importInbound } from "./importer.js";
import { handleLifecycle } from "./lifecycle.js";
import { botLoginFor } from "../github-config.js";

// Reconcile all PR-backed Sites. Called on each poll interval. Serialised per
// site via a running-flag guard so a slow interval doesn't overlap.
export async function reconcilePRBackedSites(deps: AppDeps): Promise<number> {
  // Find all PR-backed Sites across all repos.
  const sites = await findPRBackedSites(deps.db);
  let total = 0;
  for (const site of sites) {
    if (reconciling.has(site.id)) continue;
    reconciling.add(site.id);
    try {
      const n = await reconcileOneSite(deps, site.id, site.mirrorBinding.repo, site.mirrorBinding.prNumber);
      total += n;
    } catch (err) {
      // One site's failure must not crash the whole poll — log and continue.
      console.error(`[collab] reconcile error for site ${site.slug}:`, err);
    } finally {
      reconciling.delete(site.id);
    }
  }
  return total;
}

export interface MirrorDrainResult {
  /** Outbound comment_mirrors rows re-dispatched by the bus's pending-row sweep. */
  drained: boolean;
  /** Inbound events accepted by the reconcile poll across all PR-backed Sites. */
  reconciled: number;
}

// The shared drain+reconcile sweep (ADR-0015): outbound retry (mirrorBus's
// pending/failed-under-cap rows) plus inbound reconcile (this poll), run back
// to back. No-ops (drained: false, reconciled: 0) when no mirror providers are
// registered — callers (the boot interval, `/internal/drain`) don't need to
// check that themselves.
export async function runMirrorDrain(deps: AppDeps): Promise<MirrorDrainResult> {
  if (deps.mirror.length === 0) return { drained: false, reconciled: 0 };
  let drained = false;
  if (deps.mirrorBus.drainNow) {
    await deps.mirrorBus.drainNow();
    drained = true;
  }
  const reconciled = await reconcilePRBackedSites(deps);
  return { drained, reconciled };
}

// Per-site reentrancy guard.
const reconciling = new Set<string>();

// Exported for testing — reconcile a single site by id + binding.
export async function reconcileOneSite(
  deps: AppDeps,
  siteId: string,
  repo: string,
  prNumber: number,
): Promise<number> {
  // Find the GitHub provider.
  const provider = deps.mirror.find((p) => p.id === "github");
  if (!provider) return 0;

  // First check lifecycle: re-fetch PR state and emit synthetic events if
  // the head advanced or PR state changed (poll-only fallback for firewalled
  // self-hosts where webhooks aren't delivered).
  await reconcileLifecycle(deps, provider.id, siteId, repo, prNumber);

  // Get the stored cursor (last seen comment id + timestamp).
  const state = await getGitHubSiteState(deps.db, siteId);
  const since = state?.lastReconciledAt?.toISOString() ?? undefined;

  // Fetch review comments from the GitHub provider. The provider wraps the API
  // and returns InboundEvents for new comments since the cursor.
  const events = await fetchNewReviewComments(deps, repo, prNumber, since);

  // Resolve/unresolve has no "since" cursor (GitHub's REST API doesn't expose
  // one for thread state) — every poll re-checks every thread's current
  // resolved state against the DB. importThreadResolved no-ops when they
  // already agree, so this is cheap when nothing changed.
  const resolveEvents = await fetchThreadResolveState(deps, repo, prNumber);

  const importerDeps = {
    db: deps.db,
    store: deps.store,
    botLogin: deps.github ? botLoginFor(deps.github) : null,
  };
  const accepted =
    (await importInbound(events, importerDeps)) + (await importInbound(resolveEvents, importerDeps));

  if (events.length === 0) return accepted;

  // Update the cursor: track the highest comment id we've seen.
  const maxCommentId = events
    .filter((e) => e.kind === "review_comment" || e.kind === "issue_comment")
    .map((e) => Number(e.externalId))
    .reduce((max, id) => Math.max(max, id), 0);

  if (maxCommentId > 0) {
    await setGitHubReconcileCursor(deps.db, {
      siteId,
      lastPrCommentId: maxCommentId,
    });
  } else {
    await setGitHubReconcileCursor(deps.db, { siteId });
  }

  return accepted;
}

// Re-fetch PR state and emit a synthetic lifecycle event when the head advanced
// or the PR was closed/merged/locked. Compares against the Latest Version's
// `provenance.sha` (for synchronize) and the Site state (for freeze events).
async function reconcileLifecycle(
  deps: AppDeps,
  _providerId: string,
  siteId: string,
  repo: string,
  prNumber: number,
): Promise<void> {
  const provider = deps.mirror.find((p) => p.id === "github");
  if (!provider) return;

  // Cast to access the wrapped GitHubApi — pragmatic: the provider owns the API
  // client. In production this is the HttpGitHubApi.
  const ghProvider = provider as unknown as { api: { getPullRequest: (repo: { owner: string; name: string }, pr: number) => Promise<{ head: { sha: string }; state: "open" | "closed"; merged: boolean }> } };
  if (!ghProvider.api?.getPullRequest) return;

  const [owner, name] = repo.split("/");
  if (!owner || !name) return;

  let prInfo;
  try {
    prInfo = await ghProvider.api.getPullRequest({ owner, name }, prNumber);
  } catch (err) {
    console.error(`[collab] reconcile: getPullRequest failed for ${repo}#${prNumber}:`, err);
    return;
  }

  // Find the site slug for getLatestManifest (which expects a slug, not id).
  // We use the latest manifest's provenance to dedup synchronize events.
  const sites = await findPRBackedSites(deps.db, repo, prNumber);
  const thisSite = sites.find((s) => s.id === siteId);
  if (!thisSite) return;
  const latestManifest = await getLatestManifest(deps.db, thisSite.slug);

  // Synchronize: emit a synthetic event when the head sha advanced.
  if (prInfo.head.sha && latestManifest?.provenance?.sha !== prInfo.head.sha) {
    await handleLifecycle(
      {
        kind: "lifecycle",
        repo,
        prNumber,
        action: "synchronize",
        headSha: prInfo.head.sha,
      },
      deps,
      provider,
    );
  }

  // `merged`+`closed` only *offers* a freeze per ADR-0008 (an Owner choice);
  // v1 has no offer UI, so the poller does not auto-freeze on merge — matching
  // handleLifecycle. Locked-PR auto-freeze arrives via the webhook path only;
  // `getPullRequest` doesn't currently surface `locked`, so it isn't polled here.
}

// Fetch review comments via the GitHub API and convert them to InboundEvents.
// This uses the provider's underlying API client to list comments since the cursor.
async function fetchNewReviewComments(
  deps: AppDeps,
  repo: string,
  prNumber: number,
  since: string | undefined,
): Promise<InboundEvent[]> {
  // The GitHubMirrorProvider wraps the GitHubApi; we need to access the API
  // client through the provider. Since the provider doesn't expose its API
  // client directly, we use a cast to get it for the reconcile poll.
  // In production, the provider is constructed with the HttpGitHubApi.
  const provider = deps.mirror.find((p) => p.id === "github");
  if (!provider) return [];

  // Use the provider's dispatch context to fetch comments. We need the GitHubApi
  // to list review comments. Access it through the provider's internal API.
  // This is a pragmatic cast — the provider owns the API client.
  const ghProvider = provider as unknown as { api: { listPrReviewComments: (repo: { owner: string; name: string }, pr: number, since?: string) => Promise<any[]> } };
  if (!ghProvider.api?.listPrReviewComments) return [];

  const [owner, name] = repo.split("/");
  if (!owner || !name) return [];

  const comments = await ghProvider.api.listPrReviewComments({ owner, name }, prNumber, since);
  return comments.map((c: any) => ({
    kind: "review_comment" as const,
    repo,
    prNumber,
    externalId: String(c.id),
    externalUrl: c.url ?? "",
    path: c.path ?? null,
    line: c.line ?? null,
    side: c.side ?? null,
    author: { login: c.user?.login ?? "unknown", avatarUrl: c.user?.avatarUrl ?? null },
    body: c.body ?? "",
    commit: c.commitId ?? "",
    action: "created" as const,
  }));
}

// Poll every review thread's resolved state via GraphQL (same call dispatchResolve
// uses outbound) and convert to synthetic `thread_resolved` InboundEvents, one per
// thread, keyed by its first comment's external id. No per-thread "since" cursor
// exists on GitHub's side; importThreadResolved is the cheap no-op guard for the
// common case where nothing changed since the last poll.
async function fetchThreadResolveState(
  deps: AppDeps,
  repo: string,
  prNumber: number,
): Promise<InboundEvent[]> {
  const provider = deps.mirror.find((p) => p.id === "github");
  if (!provider) return [];

  const ghProvider = provider as unknown as {
    api: {
      listReviewThreads: (
        repo: { owner: string; name: string },
        pr: number,
      ) => Promise<Array<{ isResolved: boolean; comments: Array<{ databaseId: number }> }>>;
    };
  };
  if (!ghProvider.api?.listReviewThreads) return [];

  const [owner, name] = repo.split("/");
  if (!owner || !name) return [];

  let threads;
  try {
    threads = await ghProvider.api.listReviewThreads({ owner, name }, prNumber);
  } catch (err) {
    console.error(`[collab] reconcile: listReviewThreads failed for ${repo}#${prNumber}:`, err);
    return [];
  }

  const events: InboundEvent[] = [];
  for (const thread of threads) {
    const first = thread.comments[0];
    if (!first) continue;
    events.push({
      kind: "thread_resolved",
      repo,
      prNumber,
      externalId: String(first.databaseId),
      resolved: thread.isResolved,
      resolvedBy: "github",
    });
  }
  return events;
}

// Start self-host's boot-time drain+reconcile interval (ADR-0015). Returns a
// stop function. The Vercel adapter never calls this — it wires the same
// `runMirrorDrain` to Vercel Cron via `/internal/drain` instead.
export function startDrainLoop(deps: AppDeps, intervalMs: number): () => void {
  if (deps.mirror.length === 0) return () => {};
  const timer = setInterval(() => {
    runMirrorDrain(deps).catch((err) => {
      // Log but don't throw — the loop must be resilient.
      console.error("[collab] drain loop error:", err);
    });
  }, intervalMs);
  return () => clearInterval(timer);
}
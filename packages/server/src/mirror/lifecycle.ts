// PR lifecycle handler (ADR-0008, Sub-Task 8): processes `lifecycle` InboundEvents
// emitted by webhooks or the reconcile poller:
// - `synchronize` (new PR head): re-fetch the PR content and append a new Version,
//   then migrate conversations forward. Deduped by `provenance.sha` so a double-fire
//   is a no-op.
// - `locked`: freeze the Site (ADR-0008 auto-freeze — the only lifecycle event
//   that freezes unilaterally).
// `closed`+`merged` only *offers* a freeze per ADR-0008 (an Owner choice, not
// auto-applied); v1 has no offer UI, so it is a no-op like `reopened`/`unlocked`.

import type { AppDeps } from "../config.js";
import type { InboundLifecycle } from "@scholia/github";
import {
  addVersionWithManifest,
  getLatestManifest,
  setSiteState,
  findPRBackedSites,
} from "@scholia/db";
import { hashBytes } from "@scholia/core";
import type { MirrorProvider } from "@scholia/core";
import { buildManifestPages } from "../manifest.js";
import { migrateConversationsToLatest } from "../migration.js";

// Process a lifecycle event for all PR-backed Sites matching the repo + prNumber.
export async function handleLifecycle(
  event: InboundLifecycle,
  deps: AppDeps,
  provider: MirrorProvider | undefined,
): Promise<void> {
  // Find all PR-backed Sites for this repo + prNumber.
  const sitesList = await findPRBackedSites(deps.db, event.repo, event.prNumber);
  if (sitesList.length === 0) return;

  for (const site of sitesList) {
    if (event.action === "synchronize" && event.headSha) {
      await handleSynchronize(event, deps, provider, site.id, site.slug);
    } else if (event.action === "locked") {
      await setSiteState(deps.db, site.id, "frozen");
    }
    // `closed`+`merged` (freeze is an Owner-driven offer in v1, not automatic),
    // `reopened`, and `unlocked` are all no-ops — the Owner manages state manually.
  }
}

// Re-fetch the PR at the new head and append a new Version. Deduped by
// provenance.sha so a double-fire or a reconcile that catches up after a webhook
// is a no-op (not a duplicate Version).
async function handleSynchronize(
  event: InboundLifecycle,
  deps: AppDeps,
  provider: MirrorProvider | undefined,
  siteId: string,
  slug: string,
): Promise<void> {
  if (!provider || !event.headSha) return;

  // Dedup: if the Latest Version's provenance.sha already matches the new head, skip.
  const latestManifest = await getLatestManifest(deps.db, slug);
  if (latestManifest?.provenance?.sha === event.headSha) return;

  // Fetch the PR content at the new head.
  let fetched;
  try {
    fetched = await provider.fetchContent({
      kind: "pr",
      repo: event.repo,
      prNumber: event.prNumber,
    });
  } catch (err) {
    console.error(`[scholia] lifecycle: re-fetch failed for ${slug}:`, err);
    return;
  }

  // Store the fetched blobs (content-addressed dedup skips already-present blobs).
  const files = [];
  for (const f of fetched.files) {
    const kind: "markdown" | "html" | "asset" = /\.(md)$/i.test(f.path)
      ? "markdown"
      : /\.(html)$/i.test(f.path)
        ? "html"
        : "asset";
    const hash = hashBytes(f.bytes);
    if (!(await deps.store.has(hash))) {
      await deps.store.put(f.bytes);
    }
    files.push({ path: f.path, kind, contentHash: hash });
  }

  // Build the manifest pages (renders markdown → renderedHash + sourceMapHash).
  const pages = await buildManifestPages(deps.store, files);

  // Append the new Version.
  await addVersionWithManifest(deps.db, {
    siteId,
    contentSource: { kind: "pr", repo: event.repo, prNumber: event.prNumber },
    provenance: fetched.provenance,
    pages,
  });

  // Migrate conversations forward (anchors re-resolve against the new Latest).
  await migrateConversationsToLatest(deps, slug, siteId);
}

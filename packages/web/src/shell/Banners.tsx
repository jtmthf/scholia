import { useEffect, useRef, useState } from "preact/hooks";
import { recordLastSeen, type SiteMeta } from "../api.js";
import { useViewerSummary } from "../data/queries.js";
import { DiffPanel } from "../versioning/DiffPanel.js";

/**
 * Reading a pinned Version rather than Latest. Full-width, because it qualifies the
 * whole Page, and it owns the one affordance out (CONTEXT "Latest").
 */
export function HistoricalBanner({ site, onGoLatest }: { site: SiteMeta; onGoLatest: () => void }) {
  return (
    <div class="version-banner version-banner--historical">
      <span>
        You're viewing <strong>Version {site.version}</strong> — not the Latest (v
        {site.latestVersion}). This is a read-only snapshot.
      </span>
      <button class="version-banner-action" onClick={onGoLatest}>
        Go to Latest
      </button>
    </div>
  );
}

/**
 * "New since last visit" (CONTEXT "Last Seen Version") — a Site-level fact, so it
 * spans the full width rather than sitting in the per-Page view.
 *
 * The order matters: the counts are captured against the *old* Last Seen Version and
 * only then is it advanced to Latest. That's why the summary query is pinned as
 * fresh — a refetch after the advance would answer "nothing new" and the banner
 * would vanish out from under the reader.
 */
export function NewsBanner({ site, viewerId }: { site: SiteMeta; viewerId: string | null }) {
  const [showDiff, setShowDiff] = useState(false);
  const summary = useViewerSummary(site.slug, viewerId, true).data ?? null;
  const recorded = useRef<string | null>(null);

  useEffect(() => {
    if (!summary || !viewerId) return;
    // Once per Viewer per Site: advancing Last Seen twice is harmless but pointless.
    const mark = `${site.slug}:${viewerId}`;
    if (recorded.current === mark) return;
    recorded.current = mark;
    // Server defaults the new value to Latest.
    void recordLastSeen(site.slug, viewerId).catch(() => {});
  }, [site.slug, viewerId, summary]);

  const diffFrom = summary?.lastSeenVersion ?? null;
  const hasNews =
    summary !== null && diffFrom !== null && (summary.newVersions > 0 || summary.newComments > 0);

  if (!hasNews || !summary) return null;

  return (
    <>
      <div class="version-banner version-banner--news">
        <span>
          {summary.newVersions > 0 && (
            <strong>
              {summary.newVersions} new Version{summary.newVersions === 1 ? "" : "s"}
            </strong>
          )}
          {summary.newVersions > 0 && summary.newComments > 0 && " · "}
          {summary.newComments > 0 && (
            <strong>
              {summary.newComments} new comment{summary.newComments === 1 ? "" : "s"}
            </strong>
          )}{" "}
          since your last visit.
        </span>
        {summary.newVersions > 0 && (
          <button class="version-banner-action" onClick={() => setShowDiff(true)}>
            View changes
          </button>
        )}
      </div>

      {showDiff && diffFrom !== null && (
        <DiffPanel
          slug={site.slug}
          from={diffFrom}
          to={site.latestVersion}
          onClose={() => setShowDiff(false)}
        />
      )}
    </>
  );
}

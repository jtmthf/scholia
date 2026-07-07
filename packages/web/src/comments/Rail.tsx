import type { ConversationDTO } from "../api";
import { Thread } from "./Thread";

interface RailProps {
  slug: string;
  conversations: ConversationDTO[];
  activeThreadId: string | null;
  onNeedViewer: () => Promise<{ viewerId: string; displayName: string }>;
  onChanged: () => void;
  /** Click a Thread → scroll its anchor into view in the content. */
  onActivateThread: (id: string) => void;
  /** Start a new page-level (un-anchored) Thread. */
  onNewPageComment: () => void;
}

// The right-hand comment rail: anchored Threads first, then page-level Threads,
// each rendered as a Thread card. Resolved Threads render collapsed (handled in
// Thread). To start an anchored Thread the user selects text in the content
// (handled by the parent via the bridge); the rail only offers the page-level
// entry point.
export function Rail({
  slug,
  conversations,
  activeThreadId,
  onNeedViewer,
  onChanged,
  onActivateThread,
  onNewPageComment,
}: RailProps) {
  // Outdated Threads (anchor no longer matches the Latest Version, CONTEXT
  // "Outdated") are pulled out of the live sections into their own collapsed rail,
  // each linking back to the Version it was made on. Everything else splits into
  // live anchored vs page-level.
  const outdated = conversations.filter((c) => c.anchorStatus === "outdated");
  const anchored = conversations.filter(
    (c) => c.anchor !== null && c.anchorStatus === "live",
  );
  const pageLevel = conversations.filter(
    (c) => c.anchor === null && c.anchorStatus === "live",
  );

  const renderThread = (c: ConversationDTO) => (
    <Thread
      key={c.id}
      slug={slug}
      conversation={c}
      active={c.id === activeThreadId}
      onNeedViewer={onNeedViewer}
      onChanged={onChanged}
      onActivate={() => onActivateThread(c.id)}
    />
  );

  return (
    <aside class="comment-rail">
      <button class="page-comment-btn" onClick={onNewPageComment}>
        💬 Comment on this page
      </button>

      {conversations.length === 0 && (
        <div class="rail-empty">
          No comments yet. Select text in the page to start a Thread, or comment on the
          whole page.
        </div>
      )}

      {anchored.length > 0 && (
        <div class="rail-section">
          <h3 class="rail-section-title">Anchored ({anchored.length})</h3>
          {anchored.map(renderThread)}
        </div>
      )}

      {pageLevel.length > 0 && (
        <div class="rail-section">
          <h3 class="rail-section-title">Page comments ({pageLevel.length})</h3>
          {pageLevel.map(renderThread)}
        </div>
      )}

      {outdated.length > 0 && (
        <div class="rail-section rail-section--outdated">
          <h3 class="rail-section-title">Outdated ({outdated.length})</h3>
          <p class="rail-outdated-note">
            These Threads no longer match the Latest Version.
          </p>
          {outdated.map((c) => (
            <div key={c.id} class="outdated-thread">
              <a
                class="outdated-origin"
                href={`/s/${encodeURIComponent(slug)}${
                  c.pagePath ? `/${c.pagePath}` : ""
                }?v=${c.createdOrdinal}`}
              >
                from v{c.createdOrdinal} ↗
              </a>
              {renderThread(c)}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

import type { ConversationDTO } from "../api";
import { Thread } from "./Thread";

interface RailProps {
  slug: string;
  conversations: ConversationDTO[];
  /** The current Viewer's private Chats (empty when no Viewer exists yet). */
  chats: ConversationDTO[];
  activeThreadId: string | null;
  onNeedViewer: () => Promise<{ viewerId: string; displayName: string }>;
  onChanged: () => void;
  /** Click a Thread → scroll its anchor into view in the content. */
  onActivateThread: (id: string) => void;
  /** Start a new page-level (un-anchored) Thread. */
  onNewPageComment: () => void;
  /** Open the "Bring your agent" panel (Viewer-scoped agent token). */
  onBringAgent: () => void;
  /** Owner token — enables the owner-only per-thread delete affordance (M9). */
  ownerToken?: string | null;
}

// The right-hand comment rail: the Viewer's private Chats first, then anchored
// public Threads, then page-level Threads, each rendered as a Thread card.
// Resolved Conversations render collapsed (handled in Thread). To start an
// anchored Conversation the user selects text in the content (handled by the
// parent via the bridge); the rail only offers the page-level + agent entry
// points.
export function Rail({
  slug,
  conversations,
  chats,
  activeThreadId,
  onNeedViewer,
  onChanged,
  onActivateThread,
  onNewPageComment,
  onBringAgent,
  ownerToken = null,
}: RailProps) {
  // Outdated Threads (anchor no longer matches the Latest Version, CONTEXT
  // "Outdated") are pulled out of the live sections into their own collapsed rail,
  // each linking back to the Version it was made on. Everything else splits into
  // live anchored vs page-level.
  const outdated = conversations.filter((c) => c.anchorStatus === "outdated");
  const anchored = conversations.filter((c) => c.anchor !== null && c.anchorStatus === "live");
  const pageLevel = conversations.filter((c) => c.anchor === null && c.anchorStatus === "live");

  const renderThread = (c: ConversationDTO) => (
    <Thread
      key={c.id}
      slug={slug}
      conversation={c}
      active={c.id === activeThreadId}
      onNeedViewer={onNeedViewer}
      onChanged={onChanged}
      onActivate={() => onActivateThread(c.id)}
      ownerToken={ownerToken}
    />
  );

  // A Chat card carries the lock affordance and a Promote control — the Viewer
  // always owns every Chat returned by /chats, so Promote is always available.
  const renderChat = (c: ConversationDTO) => (
    <Thread
      key={c.id}
      slug={slug}
      conversation={c}
      active={c.id === activeThreadId}
      onNeedViewer={onNeedViewer}
      onChanged={onChanged}
      onActivate={() => onActivateThread(c.id)}
      isPrivate
      promotable
      ownerToken={ownerToken}
    />
  );

  return (
    <aside class="comment-rail">
      <div class="rail-toolbar">
        <button class="page-comment-btn" onClick={onNewPageComment}>
          💬 Comment on this page
        </button>
        <button
          class="bring-agent-btn"
          onClick={onBringAgent}
          title="Mint a token for your own agent (read + your Chats + public comments)"
        >
          🤖 Bring your agent
        </button>
      </div>

      {conversations.length === 0 && chats.length === 0 && (
        <div class="rail-empty">
          No comments yet. Select text in the page to start a Thread or a private Chat, or comment
          on the whole page.
        </div>
      )}

      {chats.length > 0 && (
        <div class="rail-section rail-section--chats">
          <h3 class="rail-section-title">🔒 Chats (private) ({chats.length})</h3>
          <p class="rail-chats-note">Visible only to you and your agents.</p>
          {chats.map(renderChat)}
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
          <p class="rail-outdated-note">These Threads no longer match the Latest Version.</p>
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

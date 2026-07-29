import { Thread } from "./Thread.js";
import type { ConversationDTO } from "./types.js";

/**
 * A link back to where an Outdated Conversation was written, supplied by the
 * consumer because only it knows how to address that state: hosted, a `?v=`
 * permalink onto the Version the Conversation was made on; locally, nothing,
 * because live files have no earlier state to link to (CONTEXT "Version").
 * Returning null omits the link and leaves the card in the Outdated section.
 */
export type OutdatedOrigin = (
  conversation: ConversationDTO,
) => { href: string; label: string } | null;

interface RailProps {
  conversations: ConversationDTO[];
  /** The reader's private Chats (empty when there is no identity yet). */
  chats: ConversationDTO[];
  activeConversationId: string | null;
  /** Click a Conversation → scroll its anchor into view in the content. */
  onActivate: (id: string) => void;
  /** Start a new page-level (un-anchored) Thread. */
  onNewPageComment: () => void;
  /** Hand a reader's own agent a token. Omitted where there are no tokens. */
  onBringAgent?: () => void;
  outdatedOrigin?: OutdatedOrigin;
  /**
   * What the Outdated section says these Threads no longer match. The consumer's
   * words, because what they drifted from differs: a hosted Site has Versions to
   * name, Local Preview only has the file as it now stands.
   */
  outdatedNote?: string;
}

// The right-hand comment rail: the reader's private Chats first, then anchored
// public Threads, then page-level Threads, each rendered as a Thread card.
// Resolved Conversations render collapsed (handled in Thread). To start an
// anchored Conversation the user selects text in the content (handled by the
// consumer, which owns the content surface); the rail only offers the page-level +
// agent entry points.
export function Rail({
  conversations,
  chats,
  activeConversationId,
  onActivate,
  onNewPageComment,
  onBringAgent,
  outdatedOrigin,
  outdatedNote = "These Threads no longer match the current text.",
}: RailProps) {
  // Outdated Threads (anchor no longer matches the current text, CONTEXT
  // "Outdated") are pulled out of the live sections into their own collapsed rail,
  // each linking back to where it was made. Everything else splits into live
  // anchored vs page-level.
  const outdated = conversations.filter((c) => c.anchorStatus === "outdated");
  const anchored = conversations.filter((c) => c.anchor !== null && c.anchorStatus === "live");
  const pageLevel = conversations.filter((c) => c.anchor === null && c.anchorStatus === "live");

  const renderThread = (c: ConversationDTO) => (
    <Thread
      key={c.id}
      conversation={c}
      active={c.id === activeConversationId}
      onActivate={() => onActivate(c.id)}
    />
  );

  // A Chat card carries the lock affordance and a Promote control — the reader
  // always owns every Chat in this list, so Promote is always available.
  const renderChat = (c: ConversationDTO) => (
    <Thread
      key={c.id}
      conversation={c}
      active={c.id === activeConversationId}
      onActivate={() => onActivate(c.id)}
      isPrivate
      promotable
    />
  );

  return (
    <aside class="comment-rail">
      <div class="rail-toolbar">
        <button class="page-comment-btn" onClick={onNewPageComment}>
          💬 Comment on this page
        </button>
        {onBringAgent && (
          <button
            class="bring-agent-btn"
            onClick={onBringAgent}
            title="Mint a token for your own agent (read + your Chats + public comments)"
          >
            🤖 Bring your agent
          </button>
        )}
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
          <p class="rail-outdated-note">{outdatedNote}</p>
          {outdated.map((c) => {
            const origin = outdatedOrigin?.(c) ?? null;
            return (
              <div key={c.id} class="outdated-thread">
                {origin && (
                  <a class="outdated-origin" href={origin.href}>
                    {origin.label}
                  </a>
                )}
                {renderThread(c)}
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}

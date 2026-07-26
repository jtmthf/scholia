import { useState } from "preact/hooks";
import { addComment, ownerDeleteConversation, setResolved, type ConversationDTO } from "../api";
import { getViewer, setDisplayName } from "../viewer";
import { Comment } from "./Comment";
import { Composer } from "./Composer";
import { PromoteDialog } from "./PromoteDialog";

interface ThreadProps {
  slug: string;
  conversation: ConversationDTO;
  /** Highlighted because its anchor highlight was clicked / it's selected. */
  active: boolean;
  onNeedViewer: () => Promise<{ viewerId: string; displayName: string }>;
  /** Refetch conversations after any mutation. */
  onChanged: () => void;
  /** User clicked the card → scroll its anchor into view. */
  onActivate: () => void;
  /** Render a lock affordance + muted styling (a private Chat, not a Thread). */
  isPrivate?: boolean;
  /** Show the Promote control (the owning Viewer flipping a Chat → Thread). */
  promotable?: boolean;
  /** Owner token — when present, show the owner-only "Delete" moderation control. */
  ownerToken?: string | null;
}

// One Conversation card: its anchor quote (or "Page comment"), its flat comment
// list, a reply composer, and resolve/reopen — identical for a public Thread and a
// private Chat (all mutations use the same endpoints). A Chat additionally carries
// a lock affordance and, for its owning Viewer, a Promote control. Resolved
// Conversations collapse to a summary.
export function Thread({
  slug,
  conversation,
  active,
  onNeedViewer,
  onChanged,
  onActivate,
  isPrivate = false,
  promotable = false,
  ownerToken = null,
}: ThreadProps) {
  const [expanded, setExpanded] = useState(!conversation.resolved);
  const [replying, setReplying] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function deleteThread() {
    if (!ownerToken) return;
    try {
      await ownerDeleteConversation(slug, ownerToken, conversation.id);
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    }
  }

  const anchored = conversation.anchor !== null;
  const outdated = conversation.anchorStatus === "outdated";
  const viewerName = getViewer(slug)?.displayName;

  async function submitReply(body: string, displayName: string) {
    setSubmitting(true);
    setError(null);
    try {
      const { viewerId } = await onNeedViewer();
      if (displayName && !viewerName) setDisplayName(slug, displayName);
      await addComment(slug, conversation.id, {
        body,
        viewerId,
        displayName: displayName || viewerName || "Anonymous",
      });
      setReplying(false);
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Reply failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleResolved() {
    try {
      const { viewerId, displayName } = await onNeedViewer();
      await setResolved(slug, conversation.id, !conversation.resolved, {
        viewerId,
        displayName: displayName || viewerName || "Anonymous",
      });
      onChanged();
    } catch {
      // ignore — state stays as-is
    }
  }

  const cls =
    `thread-card${active ? " thread-card--active" : ""}` +
    `${conversation.resolved ? " thread-card--resolved" : ""}` +
    `${outdated ? " thread-card--outdated" : ""}` +
    `${isPrivate ? " thread-card--private" : ""}`;

  return (
    <div class={cls} onClick={onActivate}>
      <div class="thread-header">
        {isPrivate && (
          <span class="thread-lock" title="Private Chat — visible only to you and your agents">
            🔒
          </span>
        )}
        {anchored ? (
          <>
            {outdated && <span class="thread-anchor-label">outdated</span>}
            <span class="thread-anchor-quote" title={conversation.anchor!.textQuote.exact}>
              “{conversation.anchor!.textQuote.exact}”
            </span>
          </>
        ) : (
          <span class="thread-anchor-quote">Page comment</span>
        )}
        {conversation.resolved && <span class="thread-resolved-badge">Resolved</span>}
      </div>

      {conversation.resolved && !expanded ? (
        <div
          class="thread-collapsed-summary"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
          }}
        >
          {conversation.comments.length} comment
          {conversation.comments.length === 1 ? "" : "s"} — show
        </div>
      ) : (
        <>
          <div class="thread-body" onClick={(e) => e.stopPropagation()}>
            {conversation.comments.map((c) => (
              <Comment
                key={c.id}
                slug={slug}
                comment={c}
                onUpdated={onChanged}
                onDeleted={onChanged}
                onNeedViewer={onNeedViewer}
              />
            ))}
          </div>

          {conversation.resolvedBy && conversation.resolved && (
            <div class="resolved-by">Resolved by {conversation.resolvedBy}</div>
          )}

          {replying ? (
            <div onClick={(e) => e.stopPropagation()}>
              <Composer
                placeholder="Reply…"
                needsName={!viewerName}
                currentName={viewerName}
                isSubmitting={submitting}
                error={error}
                onSubmit={submitReply}
                onCancel={() => setReplying(false)}
              />
            </div>
          ) : (
            <div class="thread-actions" onClick={(e) => e.stopPropagation()}>
              <button class="thread-action-btn" onClick={() => setReplying(true)}>
                Reply
              </button>
              {promotable && (
                <button
                  class="thread-action-btn thread-action-btn--promote"
                  onClick={() => setPromoting(true)}
                >
                  Promote
                </button>
              )}
              <button
                class="thread-action-btn thread-action-btn--resolve"
                onClick={() => void toggleResolved()}
              >
                {conversation.resolved ? "Reopen" : "Resolve"}
              </button>
              {ownerToken &&
                (confirmDelete ? (
                  <>
                    <button
                      class="thread-action-btn thread-action-btn--delete"
                      onClick={() => void deleteThread()}
                    >
                      Confirm delete
                    </button>
                    <button class="thread-action-btn" onClick={() => setConfirmDelete(false)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    class="thread-action-btn thread-action-btn--delete"
                    title="Owner moderation — delete this entire conversation"
                    onClick={() => setConfirmDelete(true)}
                  >
                    Delete
                  </button>
                ))}
            </div>
          )}
        </>
      )}

      {promoting && (
        <div onClick={(e) => e.stopPropagation()}>
          <PromoteDialog
            slug={slug}
            conversation={conversation}
            onNeedViewer={onNeedViewer}
            onPromoted={onChanged}
            onClose={() => setPromoting(false)}
          />
        </div>
      )}
    </div>
  );
}

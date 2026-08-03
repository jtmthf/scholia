import { useEffect, useState } from "preact/hooks";
import { useComments } from "./port.js";
import { Comment } from "./Comment.js";
import { Composer } from "./Composer.js";
import { PromoteDialog } from "./PromoteDialog.js";
import type { ConversationDTO } from "./types.js";

interface ConversationCardProps {
  conversation: ConversationDTO;
  /** Highlighted because its anchor highlight was clicked / it's selected. */
  active: boolean;
  /** User clicked the card → scroll its anchor into view. */
  onActivate: () => void;
  /** Render a lock affordance + muted styling (a private Chat, not a Thread). */
  isPrivate?: boolean;
  /** Show the Promote control (the owning reader flipping a Chat → Thread). */
  promotable?: boolean;
  /** What promoting does on this surface — see PromoteDialog's `note`. */
  promoteNote?: string;
}

// One Conversation card: its anchor quote (or "Page comment"), its flat comment
// list, a reply composer, and resolve/reopen — identical for a public Thread and a
// private Chat (all mutations go through the same port methods). A Chat additionally
// carries a lock affordance and, for its owning reader, a Promote control. Resolved
// Conversations collapse to a summary.
//
// NOTE: CSS class names like thread-card, thread-card--private, etc. intentionally
// do not match the component name. They are asserted by e2e/tests/comment.spec.ts
// and are part of the rendered DOM — renaming them is a separate decision tracked
// separately.
export function ConversationCard({
  conversation,
  active,
  onActivate,
  isPrivate = false,
  promotable = false,
  promoteNote,
}: ConversationCardProps) {
  const port = useComments();
  const [expanded, setExpanded] = useState(!conversation.resolved);

  // Whether a resolved card is expanded is the reader's choice, but resolving is
  // not: a Conversation that has just been settled has to collapse now, not on
  // the next load. Keyed on `resolved` alone, so expanding a resolved card and
  // then reacting to a Comment inside it doesn't snap it shut again.
  useEffect(() => setExpanded(!conversation.resolved), [conversation.resolved]);
  const [replying, setReplying] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Absent port methods are surfaces this consumer doesn't have — the control
  // isn't rendered rather than rendered and failing (see CommentsPort).
  const canModerate = port.canModerate && port.deleteConversation !== undefined;
  const canResolve = port.setResolved !== undefined;
  const canPromote = promotable && port.promote !== undefined;

  async function deleteConversation() {
    if (!port.deleteConversation) return;
    try {
      await port.deleteConversation(conversation.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    }
  }

  const anchored = conversation.anchor !== null;
  const outdated = conversation.anchorStatus === "outdated";
  const viewerName = port.displayName;

  async function submitReply(body: string, displayName: string) {
    setSubmitting(true);
    setError(null);
    try {
      await port.addComment(conversation.id, { body, displayName });
      setReplying(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Reply failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleResolved() {
    if (!port.setResolved) return;
    try {
      await port.setResolved(conversation.id, !conversation.resolved);
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
              <Comment key={c.id} comment={c} />
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
                currentName={viewerName ?? undefined}
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
              {canPromote && (
                <button
                  class="thread-action-btn thread-action-btn--promote"
                  onClick={() => setPromoting(true)}
                >
                  Promote
                </button>
              )}
              {canResolve && (
                <button
                  class="thread-action-btn thread-action-btn--resolve"
                  onClick={() => void toggleResolved()}
                >
                  {conversation.resolved ? "Reopen" : "Resolve"}
                </button>
              )}
              {canModerate &&
                (confirmDelete ? (
                  <>
                    <button
                      class="thread-action-btn thread-action-btn--delete"
                      onClick={() => void deleteConversation()}
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
            conversation={conversation}
            onClose={() => setPromoting(false)}
            {...(promoteNote ? { note: promoteNote } : {})}
          />
        </div>
      )}
    </div>
  );
}

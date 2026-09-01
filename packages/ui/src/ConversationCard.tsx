import { useEffect, useRef, useState } from "preact/hooks";
import { useComments } from "./port.js";
import { Comment } from "./Comment.js";
import { Composer } from "./Composer.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { PromoteDialog } from "./PromoteDialog.js";
import type { ConversationDTO } from "./types.js";

interface ConversationCardProps {
  conversation: ConversationDTO;
  /** Highlighted because its anchor highlight was clicked / it's selected. */
  active: boolean;
  /** User clicked the card → scroll its anchor into view. */
  onActivate: () => void;
  /** The reader's pointer entered (true) or left (false) the card. */
  onHover?: (hovering: boolean) => void;
  /** Render a lock affordance + muted styling (a private Chat, not a Thread). */
  isPrivate?: boolean;
  /** Show the Promote control (the owning reader flipping a Chat → Thread). */
  promotable?: boolean;
  /** What promoting does on this surface — see PromoteDialog's `note`. */
  promoteNote?: string;
}

// One Conversation card: its anchor quote (or "Page Comment"), its flat comment
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
  onHover,
  isPrivate = false,
  promotable = false,
  promoteNote,
}: ConversationCardProps) {
  const port = useComments();
  const [expanded, setExpanded] = useState(!conversation.resolved);
  const cardRef = useRef<HTMLDivElement>(null);

  // Becoming active from outside the rail — clicking the passage in the
  // content — should bring the card into view, the other half of the
  // card→passage link a hover already gets (issue #109). `block: "nearest"`
  // so a card already on screen (including the click-on-the-card-itself case)
  // doesn't jump.
  useEffect(() => {
    if (active) cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  // Whether a resolved card is expanded is the reader's choice, but resolving is
  // not: a Conversation that has just been settled has to collapse now, not on
  // the next load. Keyed on `resolved` alone, so expanding a resolved card and
  // then reacting to a Comment inside it doesn't snap it shut again.
  useEffect(() => setExpanded(!conversation.resolved), [conversation.resolved]);
  const [replying, setReplying] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Absent port methods are surfaces this consumer doesn't have — the control
  // isn't rendered rather than rendered and failing (see CommentsPort).
  const canModerate = port.canModerate && port.deleteConversation !== undefined;
  const canReply = port.addComment !== undefined;
  const canResolve = port.setResolved !== undefined;
  const canPromote = promotable && port.promote !== undefined;

  const replyAction = port.formAction?.("reply", conversation.id);
  const resolveAction = port.formAction?.(
    conversation.resolved ? "reopen" : "resolve",
    conversation.id,
  );
  const deleteConversationAction = port.formAction?.("delete-conversation", conversation.id);
  const promoteAction = port.formAction?.("promote", conversation.id);

  async function deleteConversation() {
    if (!port.deleteConversation) return;
    await port.deleteConversation(conversation.id);
  }

  const anchored = conversation.anchor !== null;
  const outdated = conversation.anchorStatus === "outdated";
  const viewerName = port.displayName;

  async function submitReply(body: string, displayName: string) {
    if (!port.addComment) return;
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

  // Everything below the header, and the whole of what a resolved
  // Conversation folds away: the Comments, who settled it, the reply
  // Composer and the actions. One definition, rendered either bare or inside
  // the disclosure, so the two never drift apart.
  const details = (
    <>
      <div class="thread-body" onClick={(e) => e.stopPropagation()}>
        {conversation.comments.map((c) => (
          <Comment key={c.id} comment={c} />
        ))}
      </div>

      {conversation.resolvedBy && conversation.resolved && (
        <div class="resolved-by">Resolved by {conversation.resolvedBy}</div>
      )}

      {(replying || replyAction) && (
        <div class="thread-reply" onClick={(e) => e.stopPropagation()}>
          <Composer
            placeholder="Reply…"
            submitLabel="Reply"
            needsName={!viewerName}
            currentName={viewerName ?? undefined}
            isSubmitting={submitting}
            error={error}
            formAction={replyAction}
            autoFocus={false}
            onSubmit={submitReply}
            onCancel={replyAction ? undefined : () => setReplying(false)}
          />
        </div>
      )}
      {!replying && (
        <div class="thread-actions" onClick={(e) => e.stopPropagation()}>
          {!replyAction && canReply && (
            <button class="thread-action-btn" onClick={() => setReplying(true)}>
              Reply
            </button>
          )}
          {canPromote &&
            (promoteAction ? (
              <form
                class="thread-action-form"
                action={promoteAction.action}
                method={promoteAction.method}
                onSubmit={(e) => {
                  e.preventDefault();
                  setPromoting(true);
                }}
              >
                {promoteAction.hidden.map((field) => (
                  <input key={field.name} type="hidden" name={field.name} value={field.value} />
                ))}
                {conversation.comments.map((comment) => (
                  <input key={comment.id} type="hidden" name="commentIds" value={comment.id} />
                ))}
                <button class="thread-action-btn thread-action-btn--promote" type="submit">
                  Promote
                </button>
              </form>
            ) : (
              <button
                class="thread-action-btn thread-action-btn--promote"
                onClick={() => setPromoting(true)}
              >
                Promote
              </button>
            ))}
          {canResolve &&
            (resolveAction ? (
              <form
                class="thread-action-form"
                action={resolveAction.action}
                method={resolveAction.method}
                onSubmit={(e) => {
                  e.preventDefault();
                  void toggleResolved();
                }}
              >
                {resolveAction.hidden.map((field) => (
                  <input key={field.name} type="hidden" name={field.name} value={field.value} />
                ))}
                <button class="thread-action-btn thread-action-btn--resolve" type="submit">
                  {conversation.resolved ? "Reopen" : "Resolve"}
                </button>
              </form>
            ) : (
              <button
                class="thread-action-btn thread-action-btn--resolve"
                onClick={() => void toggleResolved()}
              >
                {conversation.resolved ? "Reopen" : "Resolve"}
              </button>
            ))}
          {canModerate &&
            (deleteConversationAction ? (
              <form
                class="thread-action-form"
                action={deleteConversationAction.action}
                method={deleteConversationAction.method}
                onSubmit={(e) => {
                  e.preventDefault();
                  setDeleting(true);
                }}
              >
                {deleteConversationAction.hidden.map((field) => (
                  <input key={field.name} type="hidden" name={field.name} value={field.value} />
                ))}
                <button
                  class="thread-action-btn thread-action-btn--delete"
                  type="submit"
                  title="Owner moderation — delete this entire Conversation"
                >
                  Delete Conversation
                </button>
              </form>
            ) : (
              <button
                class="thread-action-btn thread-action-btn--delete"
                title="Owner moderation — delete this entire Conversation"
                onClick={() => setDeleting(true)}
              >
                Delete Conversation
              </button>
            ))}
        </div>
      )}
    </>
  );

  const cls =
    `thread-card${active ? " thread-card--active" : ""}` +
    `${conversation.resolved ? " thread-card--resolved" : ""}` +
    `${outdated ? " thread-card--outdated" : ""}` +
    `${isPrivate ? " thread-card--private" : ""}`;

  return (
    <div
      ref={cardRef}
      class={cls}
      onClick={onActivate}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
    >
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
          <span class="thread-anchor-quote">Page Comment</span>
        )}
        {conversation.resolved && <span class="thread-resolved-badge">Resolved</span>}
      </div>

      {conversation.promotedFrom && (
        <div class="thread-origin">
          Promoted from Chat{" "}
          <span class="thread-origin-id">{conversation.promotedFrom.conversationId}</span>
        </div>
      )}

      {conversation.promotions && conversation.promotions.length > 0 && (
        <div class="thread-promotions">
          {conversation.promotions.map((p) => (
            <div key={p.threadId} class="thread-promotion">
              Promoted to Thread <span class="thread-promotion-id">{p.threadId}</span> (
              {p.commentIds.length} message{p.commentIds.length === 1 ? "" : "s"})
            </div>
          ))}
        </div>
      )}

      {conversation.resolved ? (
        // A settled Conversation folds away, and folds back — a real disclosure
        // rather than a one-way "show" (issue #117). `<details>` is what makes
        // both halves true at once: it opens and it closes, it takes focus and
        // the keyboard, it announces its own expanded state, and it still works
        // with the client bundle blocked, which a click handler cannot. That
        // last point is why the Comments stay in the document while closed
        // rather than being left out of it (ADR-0034).
        <details
          class="thread-collapsible"
          open={expanded}
          onToggle={(e) => setExpanded(e.currentTarget.open)}
        >
          <summary class="thread-collapsed-summary" onClick={(e) => e.stopPropagation()}>
            <span class="thread-collapsed-caret" aria-hidden="true">
              ▸
            </span>
            {conversation.comments.length} Comment
            {conversation.comments.length === 1 ? "" : "s"}
          </summary>
          {details}
        </details>
      ) : (
        details
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

      {deleting && (
        <div onClick={(e) => e.stopPropagation()}>
          <ConfirmDialog
            title="Delete Conversation"
            message={`Delete this Conversation and its ${conversation.comments.length} ${
              conversation.comments.length === 1 ? "Comment" : "Comments"
            }?`}
            confirmLabel="Delete"
            onConfirm={deleteConversation}
            onClose={() => setDeleting(false)}
          />
        </div>
      )}
    </div>
  );
}

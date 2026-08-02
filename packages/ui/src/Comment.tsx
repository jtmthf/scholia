import { useState } from "preact/hooks";
import { useComments } from "./port.js";
import { IdentityDisplay } from "./Identity.js";
import { Reactions } from "./Reactions.js";
import type { CommentDTO } from "./types.js";

interface CommentProps {
  comment: CommentDTO;
}

export function Comment({ comment }: CommentProps) {
  const port = useComments();
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const [editError, setEditError] = useState<string | null>(null);
  const [editPending, setEditPending] = useState(false);

  function formatTime(iso: string): string {
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  // A method the port doesn't supply is an affordance this surface doesn't have,
  // so it is never rendered (see CommentsPort).
  //
  // Editing is the author's alone — the Owner moderates by removing a Comment,
  // not by rewriting it — but deleting is either the author's or the Owner's
  // (CONTEXT "Owner"). The two are labelled differently so a reader can tell
  // which of the two they are doing.
  const canEdit = comment.mine && !comment.deleted && port.editComment !== undefined;
  const moderating = !comment.mine && port.canModerate;
  const canDelete =
    (comment.mine || moderating) && !comment.deleted && port.deleteComment !== undefined;

  async function handleEdit(e: Event) {
    e.preventDefault();
    const body = editBody.trim();
    if (!body || !port.editComment) return;
    setEditPending(true);
    setEditError(null);
    try {
      await port.editComment(comment.id, { body });
      setEditing(false);
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : "Edit failed.");
    } finally {
      setEditPending(false);
    }
  }

  async function handleDelete() {
    if (!port.deleteComment) return;
    if (!confirm(moderating ? "Delete this comment as the Owner?" : "Delete this comment?")) return;
    try {
      await port.deleteComment(comment.id);
    } catch {
      // ignore — comment stays visible
    }
  }

  if (comment.deleted) {
    return (
      <div class="comment">
        <span class="comment-tombstone">comment deleted</span>
      </div>
    );
  }

  return (
    <div class="comment">
      <div class="comment-header">
        <IdentityDisplay identity={comment.author} />
        <span class="comment-timestamp">{formatTime(comment.createdAt)}</span>
        {comment.editedAt && <span class="comment-edited">&nbsp;(edited)</span>}
      </div>

      {editing ? (
        <form class="comment-edit-form" onSubmit={(e) => void handleEdit(e)}>
          <textarea
            value={editBody}
            onInput={(e) => setEditBody((e.target as HTMLTextAreaElement).value)}
          />
          {editError && <div class="composer-error">{editError}</div>}
          <div class="comment-edit-actions">
            <button class="btn-primary" type="submit" disabled={editPending || !editBody.trim()}>
              {editPending ? "Saving…" : "Save"}
            </button>
            <button
              class="btn-secondary"
              type="button"
              onClick={() => {
                setEditing(false);
                setEditBody(comment.body);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div class="comment-body">{comment.body}</div>
      )}

      <Reactions commentId={comment.id} reactions={comment.reactions} />

      {(canEdit || canDelete) && (
        <div class="comment-actions">
          {canEdit && (
            <button
              class="comment-action-btn"
              onClick={() => {
                setEditing((e) => !e);
                setEditBody(comment.body);
              }}
            >
              Edit
            </button>
          )}
          {canDelete && (
            <button
              class="comment-action-btn"
              title={moderating ? "Owner moderation — delete someone else's comment" : undefined}
              onClick={() => void handleDelete()}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

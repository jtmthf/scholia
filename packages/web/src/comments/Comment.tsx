import { useState } from "preact/hooks";
import { editComment, deleteComment, type CommentDTO, type ReactionGroup } from "../api";
import { IdentityDisplay } from "./Identity";
import { Reactions } from "./Reactions";

interface CommentProps {
  slug: string;
  comment: CommentDTO;
  onUpdated: (updated: CommentDTO) => void;
  onDeleted: (id: string) => void;
  onNeedViewer: () => Promise<{ viewerId: string; displayName: string }>;
}

export function Comment({ slug, comment, onUpdated, onDeleted, onNeedViewer }: CommentProps) {
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

  async function handleEdit(e: Event) {
    e.preventDefault();
    const body = editBody.trim();
    if (!body) return;
    setEditPending(true);
    setEditError(null);
    try {
      const { viewerId } = await onNeedViewer();
      const updated = await editComment(slug, comment.id, { body, viewerId });
      onUpdated(updated);
      setEditing(false);
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : "Edit failed.");
    } finally {
      setEditPending(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this comment?")) return;
    try {
      const { viewerId } = await onNeedViewer();
      await deleteComment(slug, comment.id, viewerId);
      onDeleted(comment.id);
    } catch {
      // ignore — comment stays visible
    }
  }

  function handleReactionsUpdated(reactions: ReactionGroup[]) {
    onUpdated({ ...comment, reactions });
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

      <Reactions
        slug={slug}
        commentId={comment.id}
        reactions={comment.reactions}
        viewerId={null}
        displayName=""
        onUpdated={handleReactionsUpdated}
        onNeedViewer={onNeedViewer}
      />

      {comment.mine && !comment.deleted && (
        <div class="comment-actions">
          <button
            class="comment-action-btn"
            onClick={() => {
              setEditing((e) => !e);
              setEditBody(comment.body);
            }}
          >
            Edit
          </button>
          <button class="comment-action-btn" onClick={() => void handleDelete()}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

import { useState } from "preact/hooks";
import { promote, type ConversationDTO } from "../api";

interface PromoteDialogProps {
  slug: string;
  conversation: ConversationDTO;
  onNeedViewer: () => Promise<{ viewerId: string; displayName: string }>;
  /** Refetch after a successful promotion (the Chat returns as a public Thread). */
  onPromoted: () => void;
  onClose: () => void;
}

// Promotion UI (CONTEXT "Promotion"): the owning Viewer picks which Chat Comments
// become public and optionally writes a summary, rather than dumping the raw
// transcript. Confirming flips the Chat to a public Thread in place; on reload it
// moves out of the private section into the public one.
export function PromoteDialog({
  slug,
  conversation,
  onNeedViewer,
  onPromoted,
  onClose,
}: PromoteDialogProps) {
  // Tombstones can't be promoted; offer only live Comments (all checked by default).
  const selectable = conversation.comments.filter((c) => !c.deleted);
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(selectable.map((c) => c.id)),
  );
  const [summary, setSummary] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Promoting nothing would produce an empty public Thread; require at least one
  // chosen Comment or a summary to carry the gist forward.
  const canPromote = (checked.size > 0 || summary.trim().length > 0) && !submitting;

  async function handlePromote() {
    setSubmitting(true);
    setError(null);
    try {
      const { viewerId } = await onNeedViewer();
      await promote(slug, conversation.id, {
        commentIds: [...checked],
        ...(summary.trim() ? { summary: summary.trim() } : {}),
        viewerId,
      });
      onPromoted();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Promote failed.");
      setSubmitting(false);
    }
  }

  return (
    <div class="promote-backdrop" onClick={onClose}>
      <div class="promote-dialog" onClick={(e) => e.stopPropagation()}>
        <div class="promote-header">
          <span class="promote-title">Promote to a public Thread</span>
          <button class="agent-panel-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <p class="promote-note">
          Choose which messages become public. This Chat flips to a public Thread —
          everyone with the Share URL will see the selected messages.
        </p>

        <div class="promote-comments">
          {selectable.map((c) => (
            <label key={c.id} class="promote-comment">
              <input
                type="checkbox"
                checked={checked.has(c.id)}
                onChange={() => toggle(c.id)}
              />
              <span class="promote-comment-author">{c.author.name}</span>
              <span class="promote-comment-body">{c.body}</span>
            </label>
          ))}
        </div>

        <label class="promote-summary-label">
          Summary (optional)
          <textarea
            class="promote-summary"
            value={summary}
            placeholder="A short summary of what was decided…"
            onInput={(e) => setSummary((e.target as HTMLTextAreaElement).value)}
          />
        </label>

        {error && <div class="composer-error">{error}</div>}

        <div class="promote-footer">
          <button
            class="btn-primary"
            disabled={!canPromote}
            onClick={() => void handlePromote()}
          >
            {submitting ? "Promoting…" : "Promote"}
          </button>
          <button class="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { useComments } from "./port.js";
import { DialogShell } from "./DialogShell.js";
import type { ConversationDTO } from "./types.js";

interface PromoteDialogProps {
  conversation: ConversationDTO;
  onClose: () => void;
  /**
   * What promoting actually does here, in the consumer's words.
   *
   * The two surfaces genuinely differ, so this cannot be one fixed string.
   * Hosted, visibility is a column and the Chat *becomes* the Thread. Locally it
   * is a directory (ADR-0019), so Promotion writes a new Thread and the Chat
   * stays exactly where it was — and there is no Share URL to mention.
   */
  note?: string;
}

const DEFAULT_NOTE =
  "Choose which messages become public. This Chat flips to a public Thread — everyone with the Share URL will see the selected messages.";

// Promotion UI (CONTEXT "Promotion"): the owning reader picks which Chat Comments
// become public and optionally writes a summary, rather than dumping the raw
// transcript.
export function PromoteDialog({ conversation, onClose, note = DEFAULT_NOTE }: PromoteDialogProps) {
  const port = useComments();
  // Tombstones can't be promoted; offer only live Comments (all checked by default).
  const selectable = conversation.comments.filter((c) => !c.deleted);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(selectable.map((c) => c.id)));
  const [summary, setSummary] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const summaryRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    summaryRef.current?.focus();
  }, []);

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

  const handlePromote = useCallback(async () => {
    // Unreachable in practice — Thread only offers Promote when the port has it.
    if (!port.promote) return;
    setSubmitting(true);
    setError(null);
    try {
      await port.promote(conversation.id, {
        commentIds: [...checked],
        ...(summary.trim() ? { summary: summary.trim() } : {}),
      });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Promote failed.");
      setSubmitting(false);
    }
  }, [port, conversation.id, checked, summary, onClose]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (canPromote) void handlePromote();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, canPromote, handlePromote]);

  return (
    <DialogShell
      title="Promote to a public Thread"
      onClose={onClose}
      dialogClass="promote-dialog"
      titleClass="promote-title"
    >
      <p class="promote-note">{note}</p>

      <div class="promote-comments">
        {selectable.map((c) => (
          <label key={c.id} class="promote-comment">
            <input type="checkbox" checked={checked.has(c.id)} onChange={() => toggle(c.id)} />
            <span class="promote-comment-author">{c.author.name}</span>
            <span class="promote-comment-body">{c.body}</span>
          </label>
        ))}
      </div>

      <label class="promote-summary-label">
        Summary (optional)
        <textarea
          ref={summaryRef}
          class="promote-summary"
          value={summary}
          placeholder="A short summary of what was decided…"
          onInput={(e) => setSummary((e.target as HTMLTextAreaElement).value)}
        />
      </label>

      {error && <div class="composer-error">{error}</div>}

      <div class="promote-footer">
        <button class="btn-primary" disabled={!canPromote} onClick={() => void handlePromote()}>
          {submitting ? "Promoting…" : "Promote"}
        </button>
        <button class="btn-secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </DialogShell>
  );
}

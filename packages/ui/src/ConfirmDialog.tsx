import { useState } from "preact/hooks";
import { DialogShell } from "./DialogShell.js";

interface ConfirmDialogProps {
  /** Dialog heading — names the scope being deleted (e.g. "Delete Comment"). */
  title: string;
  /** What is about to be lost, spelled out rather than left to a generic warning. */
  message: string;
  /** The destructive button's caption. */
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

// The shared modal shell for a destructive confirmation (issue #103): an in-app
// dialog, the same chrome as PromoteDialog, in place of native window.confirm —
// so a Comment delete and a Conversation delete each get a distinguishable
// control instead of two buttons both accessibly named "Delete".
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Delete failed.");
      setSubmitting(false);
    }
  }

  return (
    <DialogShell title={title} onClose={onClose} dialogClass="confirm-dialog">
      <p class="dialog-message">{message}</p>

      {error && <div class="composer-error">{error}</div>}

      <div class="dialog-footer">
        <button class="btn-danger" disabled={submitting} onClick={() => void handleConfirm()}>
          {submitting ? "Deleting…" : confirmLabel}
        </button>
        <button class="btn-secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </DialogShell>
  );
}

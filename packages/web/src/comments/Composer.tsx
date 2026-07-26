import { useState } from "preact/hooks";

interface ComposerProps {
  /** Label shown above the textarea */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** If the viewer has no display name yet, prompt for one inline */
  needsName: boolean;
  currentName?: string;
  isSubmitting?: boolean;
  error?: string | null;
  /** Submit button caption (idle state); defaults to "Comment". */
  submitLabel?: string;
  onSubmit: (body: string, displayName: string) => void | Promise<void>;
  onCancel?: () => void;
}

export function Composer({
  label,
  placeholder = "Write a comment…",
  needsName,
  currentName = "",
  isSubmitting = false,
  error = null,
  submitLabel = "Comment",
  onSubmit,
  onCancel,
}: ComposerProps) {
  const [body, setBody] = useState("");
  const [name, setName] = useState(currentName);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    const trimmedBody = body.trim();
    const trimmedName = name.trim();
    if (!trimmedBody) return;
    if (needsName && !trimmedName) return;
    await onSubmit(trimmedBody, trimmedName || currentName);
    setBody("");
  }

  const canSubmit = body.trim().length > 0 && (!needsName || name.trim().length > 0);

  return (
    <form class="composer" onSubmit={(e) => void handleSubmit(e)}>
      {label && <div class="composer-label">{label}</div>}
      {needsName && (
        <div class="composer-name-row">
          <label>Name:</label>
          <input
            type="text"
            value={name}
            placeholder="Your display name"
            maxLength={64}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </div>
      )}
      <textarea
        value={body}
        placeholder={placeholder}
        onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
      />
      {error && <div class="composer-error">{error}</div>}
      <div class="composer-footer">
        <button class="btn-primary" type="submit" disabled={!canSubmit || isSubmitting}>
          {isSubmitting ? "Posting…" : submitLabel}
        </button>
        {onCancel && (
          <button class="btn-secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

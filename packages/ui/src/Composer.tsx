import { useEffect, useRef, useState } from "preact/hooks";

interface ComposerProps {
  /** Label shown above the textarea */
  label?: string;
  /** The passage this Composer is about, rendered like a rail card quote. */
  quote?: string;
  /** Placeholder text */
  placeholder?: string;
  /** If the reader has no display name yet, prompt for one inline */
  needsName: boolean;
  currentName?: string;
  isSubmitting?: boolean;
  error?: string | null;
  /** Focus the textarea on mount. Consumers that restore an un-engaged draft should pass false. */
  autoFocus?: boolean;
  /** Submit button caption (idle state); defaults to "Comment". */
  submitLabel?: string;
  /**
   * What the textarea starts with. Read once, on mount: a Composer whose text
   * could be replaced from outside mid-sentence would be a Composer that types
   * over the reader. Consumers that persist drafts hand the restored body back
   * through here (Local Preview does — issue #29).
   */
  initialBody?: string;
  /** Every keystroke, for a consumer that persists what is being written. */
  onBodyChange?: (body: string) => void;
  onSubmit: (body: string, displayName: string) => void | Promise<void>;
  onCancel?: () => void;
}

export function Composer({
  label,
  quote,
  placeholder = "Write a comment…",
  needsName,
  currentName = "",
  isSubmitting = false,
  error = null,
  submitLabel = "Comment",
  autoFocus = true,
  initialBody = "",
  onBodyChange,
  onSubmit,
  onCancel,
}: ComposerProps) {
  const [body, setBody] = useState(initialBody);
  const [name, setName] = useState(currentName);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, []);

  function changeBody(next: string): void {
    setBody(next);
    onBodyChange?.(next);
  }

  async function handleSubmit(e?: Event) {
    e?.preventDefault();
    const trimmedBody = body.trim();
    const trimmedName = name.trim();
    if (!trimmedBody) return;
    if (needsName && !trimmedName) return;
    await onSubmit(trimmedBody, trimmedName || currentName);
    setBody("");
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSubmit();
    }
  }

  const canSubmit = body.trim().length > 0 && (!needsName || name.trim().length > 0);

  return (
    <form class="composer" onSubmit={(e) => void handleSubmit(e)}>
      {label && <div class="composer-label">{label}</div>}
      {quote && (
        <div class="composer-quote" title={quote}>
          “{quote}”
        </div>
      )}
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
        ref={textareaRef}
        value={body}
        placeholder={placeholder}
        onInput={(e) => changeBody((e.target as HTMLTextAreaElement).value)}
        onKeyDown={handleKeyDown}
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

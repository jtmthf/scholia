import { useEffect, useRef, useState } from "preact/hooks";
import type { FormAction } from "./port.js";

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
   * When present, the Composer renders as a real `<form>` with this action,
   * method and hidden fields, so it submits without JavaScript. The consumer
   * supplies it; the layer never constructs a URL (ADR-0030).
   */
  formAction?: FormAction;
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
  formAction,
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
  // When the Composer renders a real `<form>` for the no-JavaScript path, the
  // submit button must stay enabled: the browser sends the field values whether
  // or not Preact's input handlers ran (ADR-0034). The server still validates.
  const submitDisabled = formAction ? Boolean(isSubmitting) : !canSubmit || isSubmitting;

  return (
    <form
      class="composer"
      action={formAction?.action}
      method={formAction?.method}
      onSubmit={(e) => void handleSubmit(e)}
    >
      {formAction?.hidden.map((field) => (
        <input key={field.name} type="hidden" name={field.name} value={field.value} />
      ))}
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
        name="body"
        value={body}
        placeholder={placeholder}
        onInput={(e) => changeBody((e.target as HTMLTextAreaElement).value)}
        onKeyDown={handleKeyDown}
      />
      {error && <div class="composer-error">{error}</div>}
      <div class="composer-footer">
        <button class="btn-primary" type="submit" disabled={submitDisabled}>
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

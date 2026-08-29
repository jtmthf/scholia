import { useState } from "preact/hooks";
import { Composer } from "@scholia/ui";
import type { ViewportPoint } from "./use-content-anchors.js";

interface NewConversationComposerProps {
  /** Whether this Conversation has an Anchor. */
  anchored: boolean;
  /** Whether this is headed for a public Thread or a private Chat. */
  visibility: "public" | "private";
  /** Where the selection was, so the panel opens below it. */
  at?: ViewportPoint;
  /** The passage this Composer is about, shown in its header. */
  quote?: string;
  /** Render inline in the rail rather than as a floating panel. */
  inline?: boolean;
  /** Focus the textarea on mount. */
  autoFocus?: boolean;
  displayName: string;
  /** A draft restored from a previous life of this page (issue #29). */
  initialBody?: string;
  /** Every keystroke, so the draft outlives the page it is written on. */
  onBodyChange?: (body: string) => void;
  onSubmit: (body: string) => Promise<void>;
  onCancel: () => void;
}

// Anchored at the selection, clamped so the panel can't open off-screen. Reading
// `window` while rendering is safe here and only here: `at` comes from a
// selection, which cannot exist on the server.
function panelStyle(at: ViewportPoint): Record<string, string> {
  return {
    left: `${Math.max(8, Math.min(at.left - 150, window.innerWidth - 320))}px`,
    top: `${Math.min(at.top + 12, window.innerHeight - 240)}px`,
  };
}

/**
 * Starting a Conversation is the consumer's job rather than the comment layer's:
 * it needs the Anchor the selection produced, which only this side has
 * (ADR-0030). The Composer itself is @scholia/ui's, shared with the hosted
 * viewer.
 */
export function NewConversationComposer({
  anchored,
  visibility,
  at,
  quote,
  inline,
  autoFocus,
  displayName,
  initialBody,
  onBodyChange,
  onSubmit,
  onCancel,
}: NewConversationComposerProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(body: string): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(body);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to post comment.");
    } finally {
      setSubmitting(false);
    }
  }

  // A Chat and a Thread are the same Composer over the same passage, so the copy
  // is the only thing telling the reader which one they are about to write. It
  // says so plainly, and says what "private" actually rests on here — a
  // directory git is told never to track, rather than a promise.
  const isPrivate = visibility === "private";

  const composer = (
    <Composer
      label={
        isPrivate
          ? "🔒 Ask your agent (private Chat)"
          : anchored
            ? "New comment on selection"
            : "Comment on this page"
      }
      quote={quote}
      placeholder={
        isPrivate
          ? `Ask your agent about this ${anchored ? "passage" : "page"}…`
          : "Write a comment…"
      }
      submitLabel={isPrivate ? "Ask" : "Comment"}
      autoFocus={autoFocus}
      // git config already answered this (CONTEXT "Identity"), so the reader is
      // never asked to introduce themselves on their own machine.
      needsName={false}
      currentName={displayName}
      isSubmitting={submitting}
      error={error}
      initialBody={initialBody}
      onBodyChange={onBodyChange}
      onSubmit={(body) => submit(body)}
      onCancel={onCancel}
    />
  );

  if (inline) return composer;
  if (!at) return null;

  return (
    <div
      class={`floating-composer-panel${isPrivate ? " floating-composer-panel--private" : ""}`}
      style={panelStyle(at)}
    >
      {composer}
    </div>
  );
}

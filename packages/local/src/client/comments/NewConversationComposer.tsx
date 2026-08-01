import { useState } from "preact/hooks";
import { Composer } from "@scholia/ui";
import type { ViewportPoint } from "./use-content-anchors.js";

interface NewConversationComposerProps {
  /** Whether this Conversation has an Anchor, which is all the copy differs by. */
  anchored: boolean;
  /** Where the selection was, so the panel opens beside it. */
  at?: ViewportPoint;
  displayName: string;
  onSubmit: (body: string) => Promise<void>;
  onCancel: () => void;
}

// Anchored at the selection, clamped so the panel can't open off-screen; parked
// at a fixed spot for a Page-level Conversation, which has no selection to sit
// beside. Reading `window` while rendering is safe here and only here: `at` comes
// from a selection, which cannot exist on the server.
function panelStyle(at: NewConversationComposerProps["at"]): Record<string, string> {
  if (!at) return { right: "340px", top: "72px" };
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
  at,
  displayName,
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

  return (
    <div class="floating-composer-panel" style={panelStyle(at)}>
      <Composer
        label={anchored ? "New comment on selection" : "Comment on this page"}
        placeholder="Write a comment…"
        // git config already answered this (CONTEXT "Identity"), so the reader is
        // never asked to introduce themselves on their own machine.
        needsName={false}
        currentName={displayName}
        isSubmitting={submitting}
        error={error}
        onSubmit={(body) => submit(body)}
        onCancel={onCancel}
      />
    </div>
  );
}

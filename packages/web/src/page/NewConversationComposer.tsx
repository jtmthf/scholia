import { useState } from "preact/hooks";
import { Composer } from "@scholia/ui";
import { createChat, createConversation, type AnchorInput } from "../api.js";
import { ensureViewer, setDisplayName } from "../viewer.js";
import { useRefreshConversations } from "../data/queries.js";

/**
 * Which kind of Conversation is being authored. The composer tracks it so submit
 * routes to a public Thread or a private Chat, and so the labels say which one the
 * reader is about to create — the distinction is the whole point, so it is never
 * implicit.
 */
export type ComposerMode = "thread" | "chat";

export interface DraftConversation {
  /** null for a Page-level Conversation (no highlight). */
  anchor: AnchorInput | null;
  mode: ComposerMode;
  /** Where the selection was, so the panel opens below it. */
  at?: { left: number; top: number };
  /** The passage this Composer is about, shown in its header. */
  quote?: string;
}

interface NewConversationComposerProps {
  slug: string;
  pagePath: string;
  draft: DraftConversation;
  /** The reader's display name, or null if they haven't given one yet. */
  displayName: string | null;
  /** Render inline in the rail rather than as a floating panel. */
  inline?: boolean;
  /** Focus the textarea on mount. */
  autoFocus?: boolean;
  onDone: () => void;
  onCancel: () => void;
}

/**
 * Anchored at the selection, clamped so the panel can't open off-screen.
 *
 * This is the one place in the shell that reads `window` while rendering, and it is
 * safe because `at` cannot exist on the server: it comes from a selection inside the
 * content iframe, which only ever happens in a browser.
 */
function panelStyle(at: NonNullable<DraftConversation["at"]>): Record<string, string> {
  return {
    left: `${Math.max(8, Math.min(at.left - 150, window.innerWidth - 320))}px`,
    top: `${Math.min(at.top + 12, window.innerHeight - 240)}px`,
  };
}

// Starting a Conversation is the shell's job rather than the comment layer's: it
// needs the Anchor the content bridge produced, which only this side has.
export function NewConversationComposer({
  slug,
  pagePath,
  draft,
  displayName,
  inline,
  autoFocus,
  onDone,
  onCancel,
}: NewConversationComposerProps) {
  const refresh = useRefreshConversations(slug, pagePath);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(body: string, typedName: string) {
    setSubmitting(true);
    setError(null);
    try {
      const v = await ensureViewer(slug);
      if (typedName && !v.displayName) setDisplayName(slug, typedName);
      const input = {
        pagePath,
        anchor: draft.anchor,
        body,
        viewerId: v.viewerId,
        displayName: typedName || v.displayName || "Anonymous",
      };
      if (draft.mode === "chat") await createChat(slug, input);
      else await createConversation(slug, input);
      await refresh();
      onDone();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to post comment.");
    } finally {
      setSubmitting(false);
    }
  }

  const composer = (
    <Composer
      label={
        draft.mode === "chat"
          ? "Ask your agent (private)"
          : draft.anchor
            ? "New comment on selection"
            : "Comment on this page"
      }
      quote={draft.quote}
      placeholder={
        draft.mode === "chat"
          ? `Ask your agent about this ${draft.anchor ? "selection" : "page"}…`
          : "Write a comment…"
      }
      submitLabel={draft.mode === "chat" ? "Ask" : "Comment"}
      autoFocus={autoFocus}
      needsName={!displayName}
      currentName={displayName ?? undefined}
      isSubmitting={submitting}
      error={error}
      onSubmit={submit}
      onCancel={onCancel}
    />
  );

  if (inline) return composer;
  if (!draft.at) return null;

  return (
    <div class="floating-composer-panel" style={panelStyle(draft.at)}>
      {composer}
    </div>
  );
}

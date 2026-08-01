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
  /** Where the selection was, so the panel opens next to it. */
  at?: { left: number; top: number };
}

interface NewConversationComposerProps {
  slug: string;
  pagePath: string;
  draft: DraftConversation;
  /** The reader's display name, or null if they haven't given one yet. */
  displayName: string | null;
  onDone: () => void;
  onCancel: () => void;
}

/**
 * Anchored at the selection, clamped so the panel can't open off-screen; parked at a
 * fixed spot for a Page-level Conversation, which has no selection to sit beside.
 *
 * This is the one place in the shell that reads `window` while rendering, and it is
 * safe because `at` cannot exist on the server: it comes from a selection inside the
 * content iframe, which only ever happens in a browser.
 */
function panelStyle(at: DraftConversation["at"]): Record<string, string> {
  if (!at) return { right: "340px", top: "72px" };
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

  return (
    <div class="floating-composer-panel" style={panelStyle(draft.at)}>
      <Composer
        label={
          draft.mode === "chat"
            ? "Ask your agent (private)"
            : draft.anchor
              ? "New comment on selection"
              : "Comment on this page"
        }
        placeholder={
          draft.mode === "chat" ? "Ask your agent about this selection…" : "Write a comment…"
        }
        submitLabel={draft.mode === "chat" ? "Ask" : "Comment"}
        needsName={!displayName}
        currentName={displayName ?? undefined}
        isSubmitting={submitting}
        error={error}
        onSubmit={submit}
        onCancel={onCancel}
      />
    </div>
  );
}

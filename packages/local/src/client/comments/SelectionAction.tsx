import type { ViewportPoint } from "./use-content-anchors.js";

interface SelectionActionProps {
  /** Where the selection is, so the button lands over it. */
  at: ViewportPoint;
  onComment: () => void;
}

/**
 * What a selection offers in Local Preview: one action.
 *
 * The hosted viewer offers two, because a highlight is the entry point to both a
 * public Thread and a private Chat. Locally there are no Chats yet (issue #31),
 * and an affordance for something that cannot happen is worse than its absence.
 */
export function SelectionAction({ at, onComment }: SelectionActionProps) {
  return (
    <div
      class="floating-actions"
      style={{
        left: `${at.left}px`,
        top: `${at.top}px`,
        transform: "translate(-50%, -120%)",
      }}
      // Don't let the click steal focus / collapse the selection before we read it.
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        class="floating-action-btn floating-comment-btn"
        id="scholia-comment-selection"
        onClick={onComment}
      >
        💬 Comment
      </button>
    </div>
  );
}

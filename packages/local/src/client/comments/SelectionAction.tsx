import type { ViewportPoint } from "./use-content-anchors.js";

interface SelectionActionProps {
  /** Where the selection is, so the button lands over it. */
  at: ViewportPoint;
  /** Start a public Thread on the selection. */
  onComment: () => void;
  /** Start a private Chat on the selection — "ask my agent" (CONTEXT "Chat"). */
  onAsk: () => void;
}

/**
 * What a selection offers: two actions, the same two the hosted viewer offers.
 *
 * A highlight is the entry point to both halves of the product — say something
 * to the team, or ask your own agent about this passage privately. The two go to
 * different directories in the Sidecar and nothing else about them differs
 * (ADR-0019).
 */
export function SelectionAction({ at, onComment, onAsk }: SelectionActionProps) {
  return (
    <div
      class="floating-actions"
      style={{
        left: `${at.left}px`,
        top: `${at.top}px`,
        transform: "translate(-50%, 8px)",
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
      <button
        class="floating-action-btn floating-ask-btn"
        id="scholia-ask-selection"
        onClick={onAsk}
        title="Start a private Chat — kept out of git, never shared"
      >
        🔒 Ask
      </button>
    </div>
  );
}

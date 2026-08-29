interface SelectionActionsProps {
  at: { left: number; top: number };
  /** Start a public Thread on the selection. */
  onComment: () => void;
  /** Start a private Chat on the selection — "ask my agent" (CONTEXT "Chat"). */
  onAsk: () => void;
}

/**
 * What a selection offers. Two actions, because a highlight is the entry point to
 * both halves of the product: say something publicly, or ask your own agent about
 * this passage privately.
 */
export function SelectionActions({ at, onComment, onAsk }: SelectionActionsProps) {
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
      <button class="floating-action-btn floating-comment-btn" onClick={onComment}>
        💬 Comment
      </button>
      <button class="floating-action-btn floating-ask-btn" onClick={onAsk}>
        🔒 Ask
      </button>
    </div>
  );
}

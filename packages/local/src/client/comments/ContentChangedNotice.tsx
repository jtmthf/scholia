interface ContentChangedNoticeProps {
  onTake: () => void;
  /** Put the notice away without taking the update (issue #113). */
  onDismiss: () => void;
}

/**
 * What a held live reload looks like (issue #29).
 *
 * The file moved while the reader was writing, so the swap is waiting on them.
 * This says so and offers the update — quietly. It is `role="status"`, not an
 * alert or a dialog: nothing is wrong, nothing is blocked, and the draft behind
 * it is the thing that matters. Doing nothing is a valid answer; the update
 * lands by itself the moment the reader stops composing.
 */
export function ContentChangedNotice({ onTake, onDismiss }: ContentChangedNoticeProps) {
  return (
    <div id="scholia-content-changed" class="content-changed-notice" role="status">
      {/* "Page", not "file" — this is the thing the reader is looking at, and
          CONTEXT "Page" puts "file" on its Avoid list. */}
      <span class="content-changed-text">This Page changed while you were writing.</span>
      <button class="content-changed-btn" type="button" onClick={onTake}>
        Load changes
      </button>
      {/* Doing nothing is a valid answer, and so is saying so: dismissing puts
          the notice away and leaves the update waiting, exactly where it was
          (issue #113). Nothing is lost by it — the update still lands the moment
          the reader stops composing. */}
      <button
        class="content-changed-dismiss"
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

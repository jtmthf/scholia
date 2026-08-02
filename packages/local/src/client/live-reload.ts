// Live reload, and the reader's right to decide when the ground moves.
//
// Local Preview watches the tree, so an agent rewriting the file the reader is
// looking at is the normal case rather than an edge one (issue #29). A swap
// replaces the content a selection points into and a Composer was opened over,
// so while anything is being composed the swap is *held*: the update waits, the
// reader is told it is waiting, and it lands when they say so — or on its own
// the moment they are no longer holding anything.
//
// Deliberately free of the DOM. The swap itself is injected, so what is left is
// a state machine that can be reasoned about — and tested — on its own.

export interface LiveReloadGate {
  /** The server reported that the content changed. */
  notify(): void;
  /** Hold swaps (a selection is live, or a Composer is open) or let them run. */
  setHold(hold: boolean): void;
  /** Apply the waiting update now, without ending the hold. */
  take(): void;
  /** Whether an update is waiting on the reader. */
  pending(): boolean;
  /** Called whenever `pending()` changes. Returns its own unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export function createLiveReloadGate(perform: () => void | Promise<void>): LiveReloadGate {
  let held = false;
  let waiting = false;
  let running = false;
  // A change that arrived while a swap was already in flight. Folded into one
  // follow-up rather than racing a second fetch against the first.
  let changedWhileRunning = false;
  const listeners = new Set<() => void>();

  function setWaiting(next: boolean): void {
    if (waiting === next) return;
    waiting = next;
    // Copied first: a listener is free to unsubscribe itself while being called.
    for (const listener of Array.from(listeners)) listener();
  }

  async function apply(): Promise<void> {
    if (running) {
      changedWhileRunning = true;
      // The reader is composing, so this change is already theirs to take —
      // say so now rather than when the swap in flight happens to settle.
      if (held) setWaiting(true);
      return;
    }
    running = true;
    setWaiting(false);
    try {
      await perform();
    } catch {
      // A swap that failed is not a reason to stop listening for the next one;
      // the swap itself decides what a failure means (main.ts falls back to a
      // full reload).
    } finally {
      running = false;
    }
    if (!changedWhileRunning) return;
    changedWhileRunning = false;
    if (held) setWaiting(true);
    else await apply();
  }

  return {
    notify() {
      // Held and idle is the only case that stops here; `apply` already knows
      // what to do about a swap that is still in flight.
      if (held && !running) {
        setWaiting(true);
        return;
      }
      void apply();
    },
    setHold(hold) {
      if (held === hold) return;
      held = hold;
      if (!held && waiting) void apply();
    },
    take() {
      if (!waiting) return;
      void apply();
    },
    pending() {
      return waiting;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// The page's one gate. `main.ts` owns the swap and installs it at boot; the
// comment layer reaches it from here rather than being handed it as a prop,
// because the layer is hydrated onto server-rendered markup and its props are
// the server's data (ADR-0031). Null before boot, and in any context that has no
// live reload at all — every caller treats that as "nothing to hold".
let installed: LiveReloadGate | null = null;

export function installLiveReloadGate(gate: LiveReloadGate): LiveReloadGate {
  installed = gate;
  return gate;
}

export function liveReloadGate(): LiveReloadGate | null {
  return installed;
}

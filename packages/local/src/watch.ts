import { watch as chokidarWatch } from "chokidar";

const HIDDEN_OR_VENDORED = /(^|[\\/])(\.[^\\/]|node_modules([\\/]|$))/;

export interface Watcher {
  /**
   * Stops watching and cancels any debounced callback that hasn't fired yet,
   * so a burst of changes right before shutdown can never call `onChange`
   * (and, in turn, run `refresh()`) after the caller has moved on and torn
   * down the state that callback expects to still be there.
   */
  close(): Promise<void>;
}

/**
 * The Sidecar, which is a dotfile directory we very much do want to watch.
 *
 * An agent writing a Comment writes `.scholia/conversations/<id>.yaml`
 * in-process, with no server involved (ADR-0020) — so the only way a reader
 * with a preview open sees it is if the same watch channel that notices an
 * edited Page notices this too. Under the blanket dotfile rule it never would.
 */
const SIDECAR = /(^|[\\/])\.scholia([\\/]|$)/;

// Watch a path (file or directory) and invoke `onChange` with the batch of
// changed paths. chokidar 5 is glob-free, so we filter dotfiles / node_modules
// ourselves. Rapid bursts (e.g. an editor's atomic save = unlink+add) are
// coalesced into a single debounced callback so we rescan/reload only once.
export function watchPath(
  target: string | string[],
  onChange: (paths: string[]) => void,
  delay = 80,
): Watcher {
  const watcher = chokidarWatch(target, {
    ignoreInitial: true,
    ignored: (p: string) => !SIDECAR.test(p) && HIDDEN_OR_VENDORED.test(p),
  });

  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  function schedule(path: string): void {
    pending.add(path);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const batch = [...pending];
      pending.clear();
      if (!closed) onChange(batch);
    }, delay);
  }

  for (const event of ["add", "change", "unlink"] as const) {
    watcher.on(event, (path: string) => schedule(path));
  }

  return {
    async close() {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await watcher.close();
    },
  };
}

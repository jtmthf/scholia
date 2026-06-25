import { watch as chokidarWatch, type FSWatcher } from "chokidar";

// Watch a path (file or directory) and invoke `onChange` with the batch of
// changed paths. chokidar 5 is glob-free, so we filter dotfiles / node_modules
// ourselves. Rapid bursts (e.g. an editor's atomic save = unlink+add) are
// coalesced into a single debounced callback so we rescan/reload only once.
export function watchPath(
  target: string,
  onChange: (paths: string[]) => void,
  delay = 80,
): FSWatcher {
  const watcher = chokidarWatch(target, {
    ignoreInitial: true,
    ignored: (p: string) => /(^|[\\/])(\.[^\\/]|node_modules([\\/]|$))/.test(p),
  });

  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  function schedule(path: string): void {
    pending.add(path);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const batch = [...pending];
      pending.clear();
      onChange(batch);
    }, delay);
  }

  for (const event of ["add", "change", "unlink"] as const) {
    watcher.on(event, (path: string) => schedule(path));
  }

  return watcher;
}

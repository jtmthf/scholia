import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { REPO_ROOT, stripSlash } from "./env.js";

// Resolved against @scholia/cli's own node_modules (it declares the `tsx`
// dependency this preview needs to run through) rather than the shell shim at
// node_modules/.bin/tsx: under pnpm that shim is a `#!/bin/sh` script that
// itself execs node, an extra fork/exec hop on every preview launch. Spawning
// node directly against tsx's real entry below removes that hop.
const tsxCliEntry = createRequire(join(REPO_ROOT, "packages/cli/package.json")).resolve("tsx/cli");

export interface LocalPreview {
  /** Base URL the preview actually bound (the CLI falls back if its port is taken). */
  url: string;
  /** Write (or overwrite) a doc under the served root — the live-reload trigger. */
  write: (relPath: string, body: string) => Promise<void>;
  stop: () => Promise<void>;
}

const CLIENT_BUNDLE = join(REPO_ROOT, "packages/local/dist/assets/client.js");

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

// Local Preview serves its browser bundle from packages/local/dist/assets, which
// tsup builds — the same one-time step `pnpm scholia` needs. Build it if it isn't
// there so the suite is runnable from a clean checkout; a *stale* bundle is the
// developer's to refresh, exactly as it is when running the preview by hand.
async function ensureClientBundle(): Promise<void> {
  if (await exists(CLIENT_BUNDLE)) return;
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn("pnpm", ["--filter", "@scholia/local", "build"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (c) => resolve(c ?? 0));
  });
  if (code !== 0) throw new Error(`pnpm --filter @scholia/local build exited ${code}`);
}

export interface LocalPreviewOptions {
  /** Files to write under the served root before starting, keyed by relative path. */
  seed?: Record<string, string>;
  /**
   * Port to bind. Passed as `--port`, so a busy port fails loudly and names
   * itself instead of the preview silently moving and a later assertion failing
   * somewhere unrelated. Callers give each parallel worker its own.
   */
  port: number;
}

// Drive the real `scholia <dir>` CLI, the way a reader starts it. The served
// root is a throwaway temp dir rather than a committed fixture: the live-reload
// tests have to edit files under it.
export async function startLocalPreview(opts: LocalPreviewOptions): Promise<LocalPreview> {
  await ensureClientBundle();

  const seed = opts.seed ?? {};
  const root = await mkdtemp(join(tmpdir(), "scholia-e2e-preview-"));
  const write = async (relPath: string, body: string): Promise<void> => {
    const target = join(root, relPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body, "utf8");
  };
  for (const [relPath, body] of Object.entries(seed)) await write(relPath, body);

  // The CLI entry is spawned directly rather than through `pnpm scholia` (which
  // is exactly this command) so SIGTERM at teardown reaches the preview itself,
  // not a package-manager wrapper that would leave it orphaned on its port.
  //
  // HOME is redirected so ~/.scholia/config on the developer's machine can't
  // change which editor the preview resolves (and so the run can't write there).
  const child = spawn(
    process.execPath,
    [
      tsxCliEntry,
      join(REPO_ROOT, "packages/cli/src/cli.ts"),
      root,
      "--no-open",
      "--port",
      String(opts.port),
    ],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, HOME: await mkdtemp(join(tmpdir(), "scholia-e2e-home-")) },
    },
  );

  const url = await readUrl(child);
  return { url, write, stop: () => stop(child) };
}

// The CLI announces the bound address as "  ➜  http://localhost:<port>"; that
// line is the readiness signal, so there is nothing to poll.
function readUrl(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(
      () => reject(new Error(`scholia preview never printed a URL:\n${out}`)),
      60_000,
    );
    const finish = (err: Error | null, url?: string): void => {
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(url!);
    };
    child.stdout?.on("data", (d) => {
      out += d.toString();
      const url = out.match(/➜\s+(http:\/\/\S+)/)?.[1];
      if (url) finish(null, stripSlash(url));
    });
    child.stderr?.on("data", (d) => (out += d.toString()));
    child.on("error", (err) => finish(err));
    child.on("close", (code) =>
      finish(new Error(`scholia preview exited ${code} before printing a URL:\n${out}`)),
    );
  });
}

function stop(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.on("close", () => resolve());
    child.kill("SIGTERM");
    // The preview closes a chokidar watcher and two listeners on the way out;
    // don't let a hung teardown hold the whole suite.
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000);
  });
}

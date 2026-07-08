import { spawn } from "node:child_process";
import { cp, lstat, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { API_URL, REPO_ROOT } from "./env.js";

export interface SharedSite {
  slug: string;
  shareUrl: string;
  entryPath: string;
  stdout: string;
}

// Drive the real `collab share <path>` CLI against the API (the truest e2e seed:
// it exercises collect, zip detection, provenance, and the blob-negotiation
// wire). HOME is redirected to a throwaway dir so the owner token never lands in
// the developer's real ~/.collab/credentials.
//
// The target is copied into a throwaway dir before sharing so `collab share`
// writes its `.collab` site-link marker there, never into the committed fixture:
// otherwise the first run links the fixture to a Site and every later run tries
// to re-upload a new Version to it (and fails, since the token lived in a since-
// deleted throwaway HOME). The `.collab` filter also drops any stale marker so a
// polluted fixture can't leak a link into the copy. Each run gets a fresh Site.
export async function runShare(target: string): Promise<SharedSite> {
  const home = await mkdtemp(join(tmpdir(), "collab-e2e-home-"));
  const shareTarget = await isolateTarget(target);

  // `--new` forces a fresh Site every run: the e2e seed never wants the re-upload
  // path, and this makes the share idempotent regardless of any `.collab` marker a
  // prior run left behind (a zip share, for instance, drops its marker in cwd —
  // REPO_ROOT — since a zip has no source dir; see the CLI's linkDirFor).
  const { stdout, stderr, code } = await run(
    "pnpm",
    ["--silent", "collab", "share", shareTarget, "--server", API_URL, "--new"],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, HOME: home, COLLAB_SERVER: API_URL },
    },
  );

  if (code !== 0) {
    throw new Error(`collab share exited ${code}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
  }

  const shareUrl = stdout.match(/Share URL:\s*(\S+)/)?.[1];
  const entryPath = stdout.match(/Entry:\s*(\S+)/)?.[1];
  const slug = shareUrl?.match(/\/s\/([^/]+)/)?.[1];
  if (!shareUrl || !slug || !entryPath) {
    throw new Error(`could not parse Share URL/slug/entry from CLI output:\n${stdout}`);
  }

  return { slug, shareUrl, entryPath, stdout };
}

// Copy the share target (a fixture directory or a single file such as a .zip)
// into a throwaway temp dir, excluding any `.collab` marker. Returns the path to
// share from — the isolated copy — so the fixture on disk is never mutated.
async function isolateTarget(target: string): Promise<string> {
  const work = await mkdtemp(join(tmpdir(), "collab-e2e-share-"));
  const stat = await lstat(target);
  if (stat.isDirectory()) {
    await cp(target, work, {
      recursive: true,
      filter: (src) => basename(src) !== ".collab",
    });
    return work;
  }
  const dest = join(work, basename(target));
  await cp(target, dest);
  return dest;
}

function run(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

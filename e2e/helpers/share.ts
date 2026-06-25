import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
export async function runShare(target: string): Promise<SharedSite> {
  const home = await mkdtemp(join(tmpdir(), "collab-e2e-home-"));

  const { stdout, stderr, code } = await run(
    "pnpm",
    ["--silent", "collab", "share", target, "--server", API_URL],
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

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

export interface Provenance {
  remote?: string;
  sha?: string;
  branch?: string;
  dirty?: boolean;
}

async function git(cwd: string, ...args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFile("git", args, { cwd });
    return stdout.trimEnd();
  } catch {
    return undefined;
  }
}

// Best-effort git facts for the shared directory (ADR-0007). Returns undefined
// when the directory is not a git repo or git is absent — never throws.
export async function getProvenance(dir: string): Promise<Provenance | undefined> {
  const sha = await git(dir, "rev-parse", "HEAD");
  if (!sha) return undefined;

  let remote = await git(dir, "remote", "get-url", "origin");
  if (remote === undefined) {
    const firstRemote = await git(dir, "remote");
    const first = firstRemote?.split("\n")[0]?.trim();
    if (first) remote = await git(dir, "remote", "get-url", first);
  }

  const [branch, status] = await Promise.all([
    git(dir, "rev-parse", "--abbrev-ref", "HEAD"),
    git(dir, "status", "--porcelain"),
  ]);

  const prov: Provenance = { sha };
  if (remote?.trim()) prov.remote = remote.trim();
  if (branch?.trim()) prov.branch = branch.trim();
  if (status !== undefined) prov.dirty = status.length > 0;
  return prov;
}

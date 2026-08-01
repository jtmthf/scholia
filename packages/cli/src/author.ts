// Author identity resolution for local Conversations.
// Resolves from git config (user.name), falling back to the OS username
// outside a repository — matching the domain model's author contract (ADR-0018).

import { execFile as execFileCb } from "node:child_process";
import { userInfo } from "node:os";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

async function gitUserName(cwd?: string): Promise<string | undefined> {
  try {
    const args = cwd ? ["-C", cwd, "config", "user.name"] : ["config", "user.name"];
    const { stdout } = await execFile("git", args);
    const name = stdout.trimEnd();
    return name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the author identity for a local Conversation.
 *
 * 1. `git config user.name` in the project root
 * 2. `git config user.name` globally (no cwd)
 * 3. OS username from `os.userInfo()`
 *
 * Never throws — always returns a usable string.
 */
export async function resolveAuthor(rootDir: string): Promise<string> {
  const fromRepo = await gitUserName(rootDir);
  if (fromRepo) return fromRepo;

  const fromGlobal = await gitUserName();
  if (fromGlobal) return fromGlobal;

  try {
    return userInfo().username;
  } catch {
    return "unknown";
  }
}

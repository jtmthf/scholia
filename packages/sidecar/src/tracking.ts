// Committing the Sidecar: the per-repository opt-in, and undoing it (ADR-0018).
//
// Two failure modes pull in opposite directions here. A tool that silently adds
// a directory to a shared repository is a tool people uninstall — so the default
// is zero footprint, and this file is the only place that ever changes it. But a
// committed Sidecar is how ADR-0018 delivers teams without building auth, so the
// opt-in has to be one command that leaves nothing else to work out.
//
// What it does, in order:
//
//   1. deletes `.scholia/.gitignore`, the self-ignoring file that hides it
//   2. writes `.scholia/.gitattributes`, which marks Conversations `merge=union`
//      and is also the record that this repository opted in (see `layout.ts`)
//   3. stages the Sidecar
//
// The root `.gitignore` is never touched, in either direction. It is a file
// Scholia does not own and the one that conflicts on merge; a repository that
// hides the Sidecar there is told to undo it rather than having it edited out.
//
// Chats do not participate. `chats/.gitignore` ignores them unconditionally and
// git reads it last, so no opt-in — and no `git add -A` — can reach them.

import { execFile as execFileCb } from "node:child_process";
import { readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  CONVERSATIONS_DIR,
  SIDECAR_DIR,
  SIDECAR_GITATTRIBUTES,
  SIDECAR_GITIGNORE,
  ensureSidecarLayout,
  gitattributesPath,
  gitignorePath,
  isCommitted,
  sidecarDir,
  sidecarDirExists,
} from "./layout.js";

const execFile = promisify(execFileCb);

export interface CommitSidecarResult {
  /** It was already opted in — this run only re-asserted the files and the index. */
  alreadyCommitted: boolean;
  /** Repository-relative paths now in git's index, Chats never among them. */
  staged: string[];
}

export interface UncommitSidecarResult {
  /** There was an opt-in to undo. False when it was already untracked. */
  wasCommitted: boolean;
  /** Repository-relative paths taken out of the index. They stay on disk. */
  untracked: string[];
}

/** Run git in `cwd`; null when it exits non-zero, which is often the answer. */
async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFile("git", args, { cwd });
    return stdout;
  } catch {
    return null;
  }
}

/** The work tree `rootDir` is in, or null when it is in none. */
async function repoRoot(cwd: string): Promise<string | null> {
  const out = await git(cwd, ["rev-parse", "--show-toplevel"]);
  return out === null ? null : out.trimEnd();
}

/**
 * What the opt-in must find in the index afterwards, named relative to the
 * Sidecar — `.gitattributes` and every Thread. Chats are deliberately absent.
 *
 * Relative to the Sidecar rather than to the repository root because the two are
 * not reliably comparable: git reports the work tree with symlinks resolved
 * (`/var` is `/private/var` on macOS) and the path Scholia was handed may not
 * be. The tail of the path is the part both agree on.
 */
async function expectedInIndex(rootDir: string): Promise<string[]> {
  const dir = join(sidecarDir(rootDir), CONVERSATIONS_DIR);
  const entries = await readdir(dir).catch(() => [] as string[]);
  return [
    ".gitattributes",
    ...entries.filter((e) => e.endsWith(".yaml")).map((e) => `${CONVERSATIONS_DIR}/${e}`),
  ];
}

/** What git tracks under the Sidecar, repository-relative. */
async function trackedPaths(rootDir: string): Promise<string[]> {
  const out = await git(rootDir, [
    "ls-files",
    "--cached",
    "--full-name",
    "--",
    sidecarDir(rootDir),
  ]);
  return (out ?? "").split("\n").filter((line) => line.length > 0);
}

/**
 * Why git kept a path out of the index, said in terms of the file to go fix.
 *
 * Reached only when the opt-in wrote its files and git still would not take
 * them, which in practice means one thing: a `.gitignore` Scholia does not own
 * already hides the Sidecar. That is a rule someone added deliberately, so it is
 * theirs to remove — this reports it rather than editing around it.
 */
async function blockedReason(rootDir: string, missing: string): Promise<string> {
  const verbose = await git(rootDir, [
    "check-ignore",
    "-v",
    "--",
    join(sidecarDir(rootDir), missing),
  ]);
  // `<source>:<line>:<pattern>\t<path>`. Matched from the tab back rather than
  // by splitting on the first colon, because `source` is an ordinary path and
  // may well contain one (a Windows drive letter, most obviously).
  const source = verbose?.match(/^(.*?):\d+:[^\t]*\t/)?.[1];
  const name = `${SIDECAR_DIR}/${missing}`;
  return source
    ? `${name} is ignored by ${source}. Scholia does not edit a .gitignore it doesn't own — ` +
        `remove the rule there that matches the Sidecar, then run this again.`
    : `git would not stage ${name}.`;
}

/** Stage the Sidecar, or explain why git refused. */
async function stageSidecar(rootDir: string): Promise<string[]> {
  const expected = await expectedInIndex(rootDir);

  // `git add` refuses outright when the whole directory is ignored and stays
  // quiet when only part of it is, so what landed in the index is the answer,
  // not what the command said.
  await git(rootDir, ["add", "--", sidecarDir(rootDir)]);

  const tracked = await trackedPaths(rootDir);
  const missing = expected.filter(
    (path) => !tracked.some((entry) => entry === path || entry.endsWith(`/${path}`)),
  );
  if (missing.length > 0) {
    throw new Error(await blockedReason(rootDir, missing[0]!));
  }
  return tracked.sort();
}

/**
 * Restore the untracked default: the ignore file back, the opt-in's file gone.
 *
 * The ignore file is only written when it is missing, which is exactly the
 * opted-in case. A repository that never opted in may have edited its own copy,
 * and undoing something it never did is no reason to overwrite that.
 */
async function hideSidecar(rootDir: string): Promise<void> {
  await writeFile(gitignorePath(rootDir), SIDECAR_GITIGNORE, { flag: "wx" }).catch(() => {
    // Already there, saying what it needs to say.
  });
  await rm(gitattributesPath(rootDir), { force: true });
}

/**
 * Take the Sidecar out of git's index, leaving every file on disk.
 *
 * `-f` because the opt-in's own staged additions count as changes git would
 * otherwise refuse to drop; `--cached` is what keeps this a change to the index
 * and never to the Conversations themselves.
 */
async function untrackSidecar(rootDir: string): Promise<string[]> {
  const tracked = await trackedPaths(rootDir);
  if (tracked.length === 0) return [];
  await git(rootDir, ["rm", "-r", "-f", "--cached", "--quiet", "--", sidecarDir(rootDir)]);
  return tracked.sort();
}

/**
 * Opt this repository in to committing its Sidecar.
 *
 * Idempotent, and all-or-nothing: if git will not take it — because a
 * `.gitignore` outside the Sidecar hides it — the opt-in is rolled back, so the
 * repository is left untracked rather than half committed.
 */
export async function commitSidecar(rootDir: string): Promise<CommitSidecarResult> {
  // Checked before anything is written: there is no repository to opt in.
  if ((await repoRoot(rootDir)) === null) {
    throw new Error(
      `${rootDir} is not inside a git repository — committing the Sidecar is how Conversations ` +
        `travel with the content, and there is nothing here for them to travel in.`,
    );
  }

  const alreadyCommitted = await isCommitted(rootDir);

  // The directories and the Chats guard, so this works in a repository that has
  // no Conversations yet and so Chats are protected before anything is staged.
  await ensureSidecarLayout(rootDir);

  await rm(gitignorePath(rootDir), { force: true });
  await writeFile(gitattributesPath(rootDir), SIDECAR_GITATTRIBUTES);

  try {
    return { alreadyCommitted, staged: await stageSidecar(rootDir) };
  } catch (err) {
    if (!alreadyCommitted) {
      await hideSidecar(rootDir);
      await untrackSidecar(rootDir);
    }
    throw err;
  }
}

/**
 * Undo it: the Sidecar goes back to being invisible to git.
 *
 * The Conversations stay on disk and stay readable — this changes what git knows
 * about them, nothing else. Files already in a commit come out of the index as
 * deletions, which is the honest shape: removing them from history is a rewrite,
 * and not this command's business.
 */
export async function uncommitSidecar(rootDir: string): Promise<UncommitSidecarResult> {
  const wasCommitted = await isCommitted(rootDir);

  // Nothing here to hide. Writing the ignore file would conjure a Sidecar into a
  // repository that has never had one.
  if (!(await sidecarDirExists(rootDir))) return { wasCommitted, untracked: [] };

  const untracked = (await repoRoot(rootDir)) === null ? [] : await untrackSidecar(rootDir);
  await hideSidecar(rootDir);
  return { wasCommitted, untracked };
}

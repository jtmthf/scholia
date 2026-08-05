// Where the Sidecar's files go, and what the two git-facing ones say.
//
// Shared by the two halves that must agree about it: `store.ts`, which writes
// Conversations into this layout, and `tracking.ts`, which flips the whole
// Sidecar between untracked and committed (ADR-0018).
//
// The layout carries the visibility rule (ADR-0019): Threads in
// `conversations/`, Chats in `chats/`, and nothing in the YAML saying which is
// which. It also carries the opt-in, which is a fact about a file's existence
// rather than about anything's contents — see `isCommitted`.

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const SIDECAR_DIR = ".scholia";
export const CONVERSATIONS_DIR = "conversations";
export const CHATS_DIR = "chats";

/** What the Chats directory's own `.gitignore` says, and all it ever says. */
export const IGNORE_EVERYTHING = "*\n";

// The Sidecar's top-level `.gitignore`: the default, and the whole of it.
//
// `*` has no slash in it, so it matches every path under `.scholia/` at any
// depth — including this file. The Sidecar is therefore invisible to git without
// a single byte written to the root `.gitignore`, which is a file Scholia does
// not own and the one that conflicts on merge.
//
// Opting in deletes this file rather than editing it, because the obvious edit
// is wrong: `!conversations/` re-includes the directory and leaves every file in
// it excluded on its own account. That trap is why the opt-in is a command
// (ADR-0018 asks for it to be loud) and not a paragraph of instructions here.
export const SIDECAR_GITIGNORE = `# Scholia's Sidecar: Conversations stored beside the content (ADR-0018).
# Everything here, this file included, is untracked — so a repository shared
# with people who don't use Scholia carries no trace of it.
#
# To commit Threads, so Conversations travel with the content and git becomes
# the review channel:
#
#     scholia commit-sidecar
#
# which deletes this file, writes the merge attributes, and stages the store.
# \`scholia commit-sidecar --undo\` puts it back.
#
# Chats are never committed either way: chats/.gitignore ignores them
# unconditionally, and git reads it last.
*
`;

// The merge configuration, and the record that this repository opted in.
//
// One file doing both jobs is deliberate. It is committed, so a teammate who
// clones the repository gets the opt-in as well as the attributes — their
// SidecarStore sees it and leaves the ignore file unwritten, instead of quietly
// re-hiding a Sidecar the team has agreed to track.
export const SIDECAR_GITATTRIBUTES = `# Scholia's Sidecar, committed (ADR-0018, ADR-0019). This file is also how
# Scholia knows: while it exists, the Sidecar is meant to be tracked and the
# self-ignoring .gitignore is not written back.
#
# A Conversation is one append-only YAML stream, so two people replying to the
# same one produce appends to the same file rather than edits to a shared line.
# \`union\` keeps both sides instead of raising a conflict — correct here because
# the header is immutable and every state change is an event, so there is no
# field a union can corrupt. Order comes from the events' timestamps when the
# stream is read, not from where they landed in the file, and the fold dedupes
# by event id, so a rebase or cherry-pick that delivers the same event twice is
# a no-op rather than a double-post.
${CONVERSATIONS_DIR}/*.yaml merge=union
`;

/** `<root>/.scholia`. */
export function sidecarDir(rootDir: string): string {
  return join(rootDir, SIDECAR_DIR);
}

/** The Sidecar's own `.gitignore` — present exactly while it is untracked. */
export function gitignorePath(rootDir: string): string {
  return join(sidecarDir(rootDir), ".gitignore");
}

/** The Sidecar's `.gitattributes` — present exactly while it is committed. */
export function gitattributesPath(rootDir: string): string {
  return join(sidecarDir(rootDir), ".gitattributes");
}

/**
 * Has this repository opted in to committing its Sidecar?
 *
 * Answered by the presence of `.scholia/.gitattributes` and nothing else. The
 * alternative — asking git what it tracks — would put a subprocess in the path
 * of every read, and would give a different answer on a machine that has cloned
 * the opt-in but not yet fetched the Conversations.
 */
export async function isCommitted(rootDir: string): Promise<boolean> {
  return access(gitattributesPath(rootDir)).then(
    () => true,
    () => false,
  );
}

/** Does this project have a Sidecar at all yet? */
export async function sidecarDirExists(rootDir: string): Promise<boolean> {
  return access(sidecarDir(rootDir)).then(
    () => true,
    () => false,
  );
}

/**
 * Make sure the Sidecar's directories exist, each ignored as it should be.
 *
 * Three guarantees, which is why the three writes differ:
 *
 * - The directories are created unconditionally.
 * - `.scholia/.gitignore` is written **once**, with `wx`, and only while the
 *   repository has not opted in. Writing it back over an opt-in would quietly
 *   un-commit the Sidecar — on the machine that opted in, and on every teammate
 *   who cloned the result.
 * - `.scholia/chats/.gitignore` is **re-asserted every time**, because a Chat is
 *   private by construction rather than by policy. It is also the file git
 *   consults last for anything under `chats/`, so it wins over any rule someone
 *   puts in the parent: a Chat cannot be opted into sharing.
 */
export async function ensureSidecarLayout(rootDir: string): Promise<void> {
  await mkdir(join(sidecarDir(rootDir), CONVERSATIONS_DIR), { recursive: true });
  await mkdir(join(sidecarDir(rootDir), CHATS_DIR), { recursive: true });

  if (!(await isCommitted(rootDir))) {
    await writeFile(gitignorePath(rootDir), SIDECAR_GITIGNORE, { flag: "wx" }).catch(() => {
      // Already there. Leave it alone.
    });
  }

  // Written only when it doesn't already say the right thing, so the common case
  // is a read rather than a write — but written unconditionally when it does
  // not, including over an edit that tried to weaken it.
  const chatsIgnore = join(sidecarDir(rootDir), CHATS_DIR, ".gitignore");
  const current = await readFile(chatsIgnore, "utf8").catch(() => null);
  if (current !== IGNORE_EVERYTHING) {
    await writeFile(chatsIgnore, IGNORE_EVERYTHING).catch(() => {
      // A Sidecar on a read-only tree can still be read. Failing the whole
      // operation over the ignore file would make that impossible.
    });
  }
}

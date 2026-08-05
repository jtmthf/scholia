// `scholia commit-sidecar` — the per-repository opt-in to committing
// Conversations, and `--undo`, which takes it back (ADR-0018).
//
// The whole team workflow is this one command. Everything it does mechanically
// lives in `@scholia/sidecar`; what lives here is telling whoever ran it what
// changed and what to do next, because the step after this one is a commit they
// have to make themselves.

import { resolve } from "node:path";
import { commitSidecar, uncommitSidecar } from "@scholia/sidecar";

export interface SidecarCliOptions {
  root?: string;
}

/** Only Threads are ever staged, so every staged `.yaml` is one. */
function countThreads(paths: string[]): number {
  return paths.filter((p) => p.endsWith(".yaml")).length;
}

export async function sidecarCommit(options: SidecarCliOptions): Promise<void> {
  const { alreadyCommitted, staged } = await commitSidecar(resolve(options.root ?? "."));

  if (alreadyCommitted) {
    console.log("The Sidecar is already committed in this repository.");
  } else {
    console.log("The Sidecar is now committed in this repository.");
    console.log("  .scholia/.gitignore removed — Conversations are visible to git.");
    console.log("  .scholia/.gitattributes written — concurrent replies merge instead of");
    console.log("  conflicting, and are ordered by their timestamps when read.");
  }

  console.log(`  ${countThreads(staged)} Thread(s) staged. Commit when you're ready:`);
  console.log("\n      git commit -m 'commit the Scholia Sidecar'\n");
  console.log("  Chats stay private — they are not staged and cannot be.");
  console.log("  Undo any time with `scholia commit-sidecar --undo`.");
}

export async function sidecarUncommit(options: SidecarCliOptions): Promise<void> {
  const { wasCommitted, untracked } = await uncommitSidecar(resolve(options.root ?? "."));

  if (!wasCommitted) {
    console.log("The Sidecar was already untracked — nothing to undo.");
    return;
  }

  console.log("The Sidecar is untracked again.");
  console.log(`  ${untracked.length} path(s) taken out of git's index — none deleted.`);
  console.log("  .scholia/.gitignore is back, so git status is clean once you commit this.");
}

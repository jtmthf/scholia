// How every event says who did it.
//
// One helper rather than the same conditional spread in seven use cases, because
// the rule it encodes is a single decision and has to hold everywhere: an event
// names its author, and says nothing about kind unless an agent wrote it.
//
// The asymmetry is deliberate. `authorKind: human` on every document a person
// writes would be a field that is almost always the same value, in files people
// read in PR diffs — and it would make every stream written before agents could
// sign their work look different from one written after. Absent means human
// (see `AuthorKind`), so the quiet case stays quiet.

import type { AuthorKind } from "./types.js";

/** The `author`/`authorKind` pair to spread into an event. */
export function signedBy(
  author: string,
  authorKind?: AuthorKind,
): { author: string; authorKind?: AuthorKind } {
  return authorKind === "agent" ? { author, authorKind } : { author };
}

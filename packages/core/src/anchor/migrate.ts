// Cross-Version anchor migration (M6, ADR-0002). When a new Version is uploaded,
// every anchored Conversation's text-quote is re-resolved against the new Version's
// rendered text. Uniqueness by construction is the whole game: the quote was
// expanded to match exactly one location in its origin Version, so a UNIQUE match
// in the new Version migrates it forward; zero or multiple matches mark it
// **Outdated** rather than risk anchoring to the wrong span ("anchoring wrong is
// worse than an honest 'this moved'").
//
// The source range is only valid against the exact Version it was computed on
// (ADR-0002), so on a successful migration we drop the stale `sourceRange`: the
// text-quote is authoritative and the range can be recomputed lazily if needed.
// The xpath/css structural hints are likewise Version-specific but kept as
// best-effort display fast-paths on the SAME page kind; migration never trusts them.
import { searchQuote } from "./quote.js";
import type { Anchor } from "./types.js";

export type AnchorStatus = "live" | "outdated";

/** Which matcher landed a successful migration (see the fallback below). */
export type MatchKind = "context" | "exact";

export interface MigrationResult {
  status: AnchorStatus;
  /** The forward-migrated Anchor (sourceRange dropped) when `status === "live"`. */
  anchor: Anchor;
  /** How the quote re-resolved; `null` when the Anchor went Outdated. */
  matched: MatchKind | null;
}

// Re-resolve an Anchor's text-quote against the new Version's rendered text.
// Returns `live` + a range-stripped Anchor on a unique match, else `outdated`
// with the Anchor unchanged (so the rail can still show its original quote).
export function migrateAnchor(anchor: Anchor, newRenderedText: string): MigrationResult {
  const { textQuote } = anchor;
  let matched: MatchKind = "context";
  let hit = searchQuote(newRenderedText, textQuote);

  // Context fallback. Capture attaches prefix/suffix on EVERY Anchor, including
  // ones already unique by `exact` alone, explicitly as belt-and-braces
  // resilience — so context exists to secure uniqueness, not to be matched for
  // its own sake. Requiring it literally makes it the only thing that ever
  // breaks: every wrongly-Outdated case measured in the migration-accuracy spike
  // had its quoted text still present, still unique, with only the surroundings
  // rewritten. Retry without it.
  //
  // The retry is still LITERAL and still gated on a UNIQUE match, which is what
  // keeps ADR-0002's guarantee intact rather than relaxing it: a document
  // carrying decoy copies of the text fails the uniqueness gate and stays
  // Outdated. See docs/research/anchor-migration-accuracy.md.
  if (!hit && (textQuote.prefix || textQuote.suffix)) {
    hit = searchQuote(newRenderedText, { exact: textQuote.exact });
    matched = "exact";
  }

  if (!hit) return { status: "outdated", anchor, matched: null };

  // Unique match: keep the authoritative text-quote (and any structural hints);
  // discard the now-stale source range.
  const { sourceRange: _drop, ...rest } = anchor;
  return { status: "live", anchor: { ...rest }, matched };
}

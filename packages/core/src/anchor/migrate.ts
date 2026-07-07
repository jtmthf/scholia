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

export interface MigrationResult {
  status: AnchorStatus;
  /** The forward-migrated Anchor (sourceRange dropped) when `status === "live"`. */
  anchor: Anchor;
}

// Re-resolve an Anchor's text-quote against the new Version's rendered text.
// Returns `live` + a range-stripped Anchor on a unique match, else `outdated`
// with the Anchor unchanged (so the rail can still show its original quote).
export function migrateAnchor(anchor: Anchor, newRenderedText: string): MigrationResult {
  const hit = searchQuote(newRenderedText, anchor.textQuote);
  if (!hit) return { status: "outdated", anchor };

  // Unique match: keep the authoritative text-quote (and any structural hints);
  // discard the now-stale source range.
  const { sourceRange: _drop, ...rest } = anchor;
  return { status: "live", anchor: { ...rest } };
}

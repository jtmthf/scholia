// PROTOTYPE (issue #24) — PORTABLE. The two migration strategies under test.
//
// `original` is exactly what ships today (packages/core/src/anchor/migrate.ts):
// re-resolve the ORIGINAL text-quote against every new Version, forever. The
// quote is never touched on success, so migrating v1->v2->v3 is the same as
// migrating v1->v3 directly.
//
// `incremental` re-captures the quote against each new Version on a successful
// migration — the `reanchored` event issue #24 asks about. The exact text is
// preserved (that is what the comment pointed at); only the prefix/suffix context
// is re-expanded against the new document, so context drift does not accumulate.
import { searchQuote } from "../src/anchor/quote.js";
import type { Anchor, TextQuote } from "../src/anchor/types.js";
import { expandToUnique } from "./expand.js";

export type Verdict = "live" | "outdated";

/** Why a migration went Outdated — the interesting part of the tally. */
export type FailureKind =
  /** The exact text is gone from the new Version. An honest "this changed". */
  | "exact-missing"
  /** The exact text appears more than once and context could not disambiguate. */
  | "exact-ambiguous"
  /** The exact text is present EXACTLY ONCE, but the stored context no longer matches. */
  | "context-broken";

export interface StepResult {
  verdict: Verdict;
  /** Where it landed in the new text, when live. */
  span: { start: number; end: number } | null;
  /** The anchor to carry into the next step (strategy-dependent). */
  next: Anchor;
  failure: FailureKind | null;
}

export interface Strategy {
  key: "original" | "incremental";
  label: string;
  step(anchor: Anchor, newText: string): StepResult;
}

function attribute(quote: TextQuote, newText: string): FailureKind {
  let count = 0;
  let pos = 0;
  while ((pos = newText.indexOf(quote.exact, pos)) !== -1) {
    count++;
    pos += quote.exact.length;
  }
  if (count === 0) return "exact-missing";
  if (count === 1) return "context-broken";
  return "exact-ambiguous";
}

export const original: Strategy = {
  key: "original",
  label: "original quote, every Version (ships today)",
  step(anchor, newText) {
    const hit = searchQuote(newText, anchor.textQuote);
    if (!hit) {
      return {
        verdict: "outdated",
        span: null,
        next: anchor,
        failure: attribute(anchor.textQuote, newText),
      };
    }
    const { sourceRange: _drop, ...rest } = anchor;
    return { verdict: "live", span: hit, next: { ...rest }, failure: null };
  },
};

export const incremental: Strategy = {
  key: "incremental",
  label: "re-anchor on every successful migration",
  step(anchor, newText) {
    const hit = searchQuote(newText, anchor.textQuote);
    if (!hit) {
      return {
        verdict: "outdated",
        span: null,
        next: anchor,
        failure: attribute(anchor.textQuote, newText),
      };
    }
    const { sourceRange: _drop, ...rest } = anchor;
    // The `reanchored` event: context re-expanded against the Version we just
    // landed in, so the next migration compares against current surroundings.
    const requoted = expandToUnique(newText, hit.start, hit.end);
    return { verdict: "live", span: hit, next: { ...rest, textQuote: requoted }, failure: null };
  },
};

export const STRATEGIES: Strategy[] = [original, incremental];

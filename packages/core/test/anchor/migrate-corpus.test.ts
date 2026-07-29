// Regression test for the exact-only fallback, measured against the committed
// corpus of real agent rewrites (test/fixtures/anchor-migration/).
//
// The migration-accuracy spike (docs/research/anchor-migration-accuracy.md) found
// two things worth pinning here. Wrongly re-anchored never happened once in 106
// migrations — that is the failure ADR-0002 exists to prevent, and it must stay
// at zero. Wrongly Outdated happened on 29% of single edits, every instance with
// the quoted text still present and still unique, broken only by its context.
// The fallback is what closes that gap, so this asserts the gap stays closed on
// the same evidence rather than on invented examples.
import { describe, expect, test } from "vitest";
import { migrateAnchor } from "../../src/anchor/migrate.js";
import { searchQuote } from "../../src/anchor/quote.js";
import type { TextQuote } from "../../src/anchor/types.js";
import {
  expectFor,
  expectTextFor,
  layerText,
  loadRevisions,
  locate,
  LAYERS,
  readCases,
  selectionFor,
  expandToUnique,
  type Layer,
} from "../helpers/anchor-corpus.js";

const revisions = await loadRevisions();
const cases = readCases();

// Reconstruct the range a successful migration landed on, so a "follow" case can
// be checked for landing on the RIGHT text rather than merely on some text.
// migrateAnchor reports which matcher won, which is enough to replay it.
function landedText(text: string, quote: TextQuote, matched: "context" | "exact"): string | null {
  const hit = searchQuote(text, matched === "context" ? quote : { exact: quote.exact });
  return hit ? text.slice(hit.start, hit.end) : null;
}

type Outcome = "followed" | "outdated-correctly" | "wrongly-outdated" | "wrongly-reanchored";

function outcomeFor(c: (typeof cases)[number], layer: Layer): Outcome | null {
  const from = revisions.get(`${c.chain}@${c.from}`);
  const to = revisions.get(`${c.chain}@${c.to}`);
  if (!from || !to) return null;

  const before = layerText(from, layer);
  const after = layerText(to, layer);

  const at = locate(before, selectionFor(c, layer));
  // Some selections carry markdown syntax that vanishes when rendered, so they
  // are not locatable in every layer. Skipped, and the skip count is pinned below.
  if (!at) return null;

  const quote = expandToUnique(before, at.start, at.end);
  const result = migrateAnchor({ textQuote: quote }, after);
  const truth = expectFor(c, layer);

  if (result.status === "outdated") {
    return truth === "outdated" ? "outdated-correctly" : "wrongly-outdated";
  }
  if (truth === "outdated") return "wrongly-reanchored";
  const landed = landedText(after, quote, result.matched!);
  return landed === expectTextFor(c, layer) ? "followed" : "wrongly-reanchored";
}

describe("migrateAnchor against the anchor-migration corpus", () => {
  for (const layer of LAYERS) {
    describe(layer, () => {
      const scored = cases
        .map((c) => ({ c, outcome: outcomeFor(c, layer) }))
        .filter((r): r is { c: (typeof cases)[number]; outcome: Outcome } => r.outcome !== null);

      test("scores every labelled case that is locatable in this layer", () => {
        expect(scored.length).toBe(layer === "rendered" ? 41 : 42);
      });

      // The dangerous class. Zero instances measured, and the uniqueness gate is
      // what keeps it there — the fallback relaxes what must MATCH, never the
      // requirement that the match be unique.
      test("never re-anchors to the wrong text", () => {
        const wrong = scored.filter((r) => r.outcome === "wrongly-reanchored");
        expect(wrong.map((r) => r.c.id)).toEqual([]);
      });

      // Before the fallback this was 12 in each layer, every one context-broken.
      test("never marks an Anchor Outdated whose text merely moved", () => {
        const wrong = scored.filter((r) => r.outcome === "wrongly-outdated");
        expect(wrong.map((r) => r.c.id)).toEqual([]);
      });

      test("still goes Outdated when the text is genuinely gone", () => {
        const honest = scored.filter((r) => r.outcome === "outdated-correctly");
        const expected = scored.filter((r) => expectFor(r.c, layer) === "outdated");
        expect(honest.length).toBe(expected.length);
        expect(honest.length).toBeGreaterThan(0);
      });
    });
  }
});

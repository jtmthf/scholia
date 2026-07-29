import { describe, test, expect } from "vitest";
import { migrateAnchor } from "../../src/anchor/migrate.js";
import type { Anchor } from "../../src/anchor/types.js";

describe("migrateAnchor", () => {
  const base: Anchor = {
    textQuote: { exact: "the quick brown fox", prefix: "About ", suffix: " jumps" },
    sourceRange: { start: 10, end: 29 },
    xpath: "/html/body/p",
  };

  test("unique match migrates to live and drops the stale source range", () => {
    const text = "About the quick brown fox jumps over the lazy dog.";
    const result = migrateAnchor(base, text);
    expect(result.status).toBe("live");
    expect(result.anchor.sourceRange).toBeUndefined();
    // Text-quote is authoritative and preserved; structural hint kept.
    expect(result.anchor.textQuote).toEqual(base.textQuote);
    expect(result.anchor.xpath).toBe("/html/body/p");
  });

  test("no match marks the anchor outdated and leaves it unchanged", () => {
    const text = "This paragraph was rewritten entirely.";
    const result = migrateAnchor(base, text);
    expect(result.status).toBe("outdated");
    expect(result.anchor).toBe(base);
  });

  test("multiple matches mark the anchor outdated (never guess an occurrence)", () => {
    const anchor: Anchor = { textQuote: { exact: "TODO" } };
    const text = "TODO one and TODO two";
    const result = migrateAnchor(anchor, text);
    expect(result.status).toBe("outdated");
  });

  test("prefix/suffix context disambiguates an otherwise-repeated exact", () => {
    const anchor: Anchor = {
      textQuote: { exact: "value", prefix: "second ", suffix: " here" },
    };
    const text = "first value there, second value here";
    const result = migrateAnchor(anchor, text);
    expect(result.status).toBe("live");
    expect(result.matched).toBe("context");
  });

  // The exact-only fallback. Every wrongly-Outdated case in the
  // migration-accuracy spike had this shape: quoted text intact and unique, only
  // the surroundings rewritten (docs/research/anchor-migration-accuracy.md).
  describe("exact-only fallback", () => {
    test("rescues an anchor whose text survived but whose surroundings were rewritten", () => {
      const text = "Completely different lead-in the quick brown fox and a new tail.";
      const result = migrateAnchor(base, text);
      expect(result.status).toBe("live");
      expect(result.matched).toBe("exact");
      // Still the authoritative quote, context and all — the fallback relaxes what
      // must MATCH, never what is stored.
      expect(result.anchor.textQuote).toEqual(base.textQuote);
      expect(result.anchor.sourceRange).toBeUndefined();
    });

    test("does not resurrect an anchor whose text is genuinely gone", () => {
      const result = migrateAnchor(base, "This paragraph was rewritten entirely.");
      expect(result.status).toBe("outdated");
      expect(result.matched).toBeNull();
    });

    test("the uniqueness gate still holds when context breaks and decoys exist", () => {
      // `exact` survives twice over, so dropping context cannot pick a winner.
      // This is the class ADR-0002 exists to refuse: anchoring wrong is worse
      // than an honest "this moved".
      const text = "the quick brown fox here, and the quick brown fox there";
      const result = migrateAnchor(base, text);
      expect(result.status).toBe("outdated");
      expect(result.matched).toBeNull();
    });

    test("an anchor with no stored context never takes the fallback path", () => {
      const anchor: Anchor = { textQuote: { exact: "TODO" } };
      const result = migrateAnchor(anchor, "TODO one and TODO two");
      expect(result.status).toBe("outdated");
      expect(result.matched).toBeNull();
    });

    test("reports `context` when the full quote still matches, so the two are distinguishable", () => {
      const result = migrateAnchor(base, "About the quick brown fox jumps over the lazy dog.");
      expect(result.matched).toBe("context");
    });
  });
});

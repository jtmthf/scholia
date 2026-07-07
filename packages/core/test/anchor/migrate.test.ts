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
  });
});

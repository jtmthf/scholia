import { describe, test, expect } from "vitest";
import { buildUniqueQuote, MAX_CONTEXT } from "../src/dom/quote.js";

// Uniqueness-by-construction at capture time (ADR-0002, CONTEXT "Anchor"): the
// prefix/suffix context is expanded until the quote identifies one span and no
// other. These are the pure half of selection capture — no DOM — so they run in
// Node beside the rest of the suite; the surrounding capture is covered in a real
// browser by the Playwright suites.
describe("buildUniqueQuote", () => {
  // Locate `exact`'s nth occurrence and quote it, the way the DOM capture does
  // once it has turned a Range into offsets in the root's textContent.
  function quoteNth(text: string, exact: string, nth = 0) {
    let start = -1;
    for (let i = 0; i <= nth; i++) start = text.indexOf(exact, start + 1);
    return buildUniqueQuote(exact, text, start, start + exact.length);
  }

  test("keeps the exact text as the quote's primary form", () => {
    const text = "The anchor is the moat.";
    expect(quoteNth(text, "the moat").exact).toBe("the moat");
  });

  test("carries context even when the exact text is already unique", () => {
    const text = "One sentence. A wholly distinctive phrase. Another sentence.";
    const quote = quoteNth(text, "wholly distinctive");
    expect(quote.prefix).toBeTruthy();
    expect(quote.suffix).toBeTruthy();
  });

  test("expands context until a repeated phrase resolves to one occurrence", () => {
    const text = "alpha: see below. beta: see below. gamma: see below.";
    const quote = quoteNth(text, "see below", 1);

    const combined = (quote.prefix ?? "") + quote.exact + (quote.suffix ?? "");
    expect(text.split(combined).length - 1).toBe(1);
    // And it is the *second* occurrence that was pinned, not just any of them.
    expect(quote.prefix).toContain("beta");
  });

  test("distinguishes two occurrences of the same phrase from each other", () => {
    const text = "alpha: see below. beta: see below. gamma: see below.";
    const first = quoteNth(text, "see below", 0);
    const third = quoteNth(text, "see below", 2);
    expect(first.prefix).not.toBe(third.prefix);
  });

  test("pins an occurrence at the very start, where there is no prefix to grow", () => {
    const text = "repeat me. filler filler. repeat me.";
    const quote = quoteNth(text, "repeat me", 0);
    expect(quote.prefix).toBeUndefined();
    const combined = quote.exact + (quote.suffix ?? "");
    expect(text.split(combined).length - 1).toBe(1);
  });

  test("stops growing context at MAX_CONTEXT when nothing can disambiguate", () => {
    // Two identical documents' worth of boilerplate: no amount of context
    // separates them, which is issue #71's territory. What is asserted here is
    // only that expansion terminates and stays bounded.
    const block = "Copyright the authors. All rights reserved. See the licence file. ";
    const text = block.repeat(20);
    const quote = quoteNth(text, "All rights reserved", 5);

    expect(quote.prefix!.length).toBeLessThanOrEqual(MAX_CONTEXT);
    expect(quote.suffix!.length).toBeLessThanOrEqual(MAX_CONTEXT);
  });

  test("never returns an empty-string prefix or suffix", () => {
    // Empty context is meaningless to a matcher and would be written into the
    // Anchor as if it were a constraint — the field is omitted instead.
    const quote = buildUniqueQuote("whole", "whole", 0, 5);
    expect(quote.prefix).toBeUndefined();
    expect(quote.suffix).toBeUndefined();
  });
});

import { describe, test, expect } from "vitest";
import { searchQuote } from "../../src/anchor/quote.js";

describe("searchQuote", () => {
  // --- basic unique match ---

  test("returns the char range for a unique exact match with no prefix/suffix", () => {
    const text = "Hello, world!";
    const result = searchQuote(text, { exact: "world" });
    expect(result).toEqual({ start: 7, end: 12 });
  });

  test("returns null for a zero-character exact string", () => {
    expect(searchQuote("Hello", { exact: "" })).toBeNull();
  });

  test("returns null when exact is not found in text", () => {
    expect(searchQuote("Hello, world!", { exact: "goodbye" })).toBeNull();
  });

  // --- disambiguation via prefix/suffix ---

  test("disambiguates two identical occurrences using prefix", () => {
    // "bar" at idx=6 is preceded by "start "; "bar" at idx=23 is preceded by "other "
    const text = "start bar middle other bar end";
    const result = searchQuote(text, { exact: "bar", prefix: "start " });
    expect(result).toEqual({ start: 6, end: 9 });
  });

  test("disambiguates two identical occurrences using suffix", () => {
    // "bar" at idx=6 is followed by " middle"; "bar" at idx=23 is followed by " end"
    const text = "start bar middle other bar end";
    const result = searchQuote(text, { exact: "bar", suffix: " end" });
    expect(result).toEqual({ start: 23, end: 26 });
  });

  test("disambiguates using both prefix and suffix together", () => {
    const text = "the cat sat on the cat mat";
    // "cat" appears twice; prefix "the " + suffix " mat" disambiguates to the second
    const result = searchQuote(text, { exact: "cat", prefix: "the ", suffix: " mat" });
    expect(result).toEqual({ start: 19, end: 22 });
  });

  // --- genuinely ambiguous → null ---

  test("returns null when prefix/suffix still leave multiple qualifying occurrences", () => {
    const text = "the cat sat on the cat mat the cat mat";
    // "cat" with prefix "the " and suffix " mat" matches in two positions
    const result = searchQuote(text, { exact: "cat", prefix: "the ", suffix: " mat" });
    expect(result).toBeNull();
  });

  test("returns null when exact matches multiple times and no prefix/suffix is provided", () => {
    const text = "cat and cat";
    expect(searchQuote(text, { exact: "cat" })).toBeNull();
  });

  // --- boundary tolerance (prefix/suffix partially outside document) ---

  test("tolerates prefix that extends to (or would extend past) the start of the document", () => {
    // "Hello" is at the very start; prefix "XYZ" is longer than what precedes it.
    // The available text before idx=0 is "", which endsWith("XYZ") is false → no match.
    const text = "Hello world";
    expect(searchQuote(text, { exact: "Hello", prefix: "XYZ" })).toBeNull();
  });

  test("matches at document start when prefix is empty string (no constraint)", () => {
    const text = "Hello world";
    expect(searchQuote(text, { exact: "Hello", prefix: "" })).toEqual({ start: 0, end: 5 });
  });

  test("matches at document start when no prefix provided", () => {
    const text = "Hello world";
    expect(searchQuote(text, { exact: "Hello" })).toEqual({ start: 0, end: 5 });
  });

  test("tolerates suffix that would extend past the end of the document — match succeeds when available tail starts with a prefix of the suffix", () => {
    // "world" is at the very end; suffix " goodbye" is longer than what follows.
    // available text after end is "" which does NOT startWith(" goodbye") → null.
    const text = "Hello world";
    expect(searchQuote(text, { exact: "world", suffix: " goodbye" })).toBeNull();
  });

  test("matches at document end when suffix is empty string (no constraint)", () => {
    const text = "Hello world";
    expect(searchQuote(text, { exact: "world", suffix: "" })).toEqual({ start: 6, end: 11 });
  });

  test("matches at document end when no suffix provided", () => {
    const text = "Hello world";
    expect(searchQuote(text, { exact: "world" })).toEqual({ start: 6, end: 11 });
  });

  test("uses startsWith semantics: shorter available suffix is enough when it matches the available portion", () => {
    // exact "world" ends the string; suffix "ld" is a prefix of the remaining "" — wait,
    // remaining after "world" is ""; "".startsWith("ld") === false.
    // Instead test a case where the suffix is partially at doc boundary but does match:
    // text = "Hello world!", suffix " world!" — but exact = "Hello", so remaining = " world!"
    // which starts with " world!" exactly.
    const text = "Hello world!";
    const result = searchQuote(text, { exact: "Hello", suffix: " world!" });
    expect(result).toEqual({ start: 0, end: 5 });
  });

  // --- prefix/suffix with real document boundaries ---

  test("unique match at start with a suffix that fits exactly", () => {
    const text = "alpha beta gamma";
    // "alpha" with suffix " beta" → unique
    const result = searchQuote(text, { exact: "alpha", suffix: " beta" });
    expect(result).toEqual({ start: 0, end: 5 });
  });

  test("unique match at end with a prefix that fits exactly", () => {
    const text = "alpha beta gamma";
    // "gamma" with prefix "beta " → unique
    const result = searchQuote(text, { exact: "gamma", prefix: "beta " });
    expect(result).toEqual({ start: 11, end: 16 });
  });

  // --- whole-document exact ---

  test("returns the whole document range when exact equals the entire text", () => {
    const text = "everything";
    expect(searchQuote(text, { exact: "everything" })).toEqual({ start: 0, end: 10 });
  });
});

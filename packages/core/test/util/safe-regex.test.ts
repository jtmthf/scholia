import { describe, test, expect } from "vitest";
import {
  guardRegexInput,
  safeTest,
  safeExec,
  safeMatch,
  safeReplace,
  safeSplit,
  MAX_REGEX_INPUT,
} from "@scholia/core";

// Unit tests for the safe-regex input-length guards (ADR-0033). Verifies that
// the guards reject overlong input and pass through valid input.

describe("guardRegexInput", () => {
  test("returns input when under limit", () => {
    expect(guardRegexInput("hello", 100)).toBe("hello");
  });

  test("returns input when exactly at limit", () => {
    expect(guardRegexInput("abc", 3)).toBe("abc");
  });

  test("throws when input exceeds limit", () => {
    expect(() => guardRegexInput("hello", 3)).toThrow("Input too long for regex operation: 5 > 3.");
  });

  test("uses DEFAULT max when no limit provided", () => {
    const ok = "a".repeat(MAX_REGEX_INPUT);
    expect(guardRegexInput(ok)).toBe(ok);
    const tooLong = "a".repeat(MAX_REGEX_INPUT + 1);
    expect(() => guardRegexInput(tooLong)).toThrow(/Input too long/);
  });
});

describe("safeTest", () => {
  test("returns regex test result for valid input", () => {
    expect(safeTest(/hello/, "hello world")).toBe(true);
    expect(safeTest(/goodbye/, "hello world")).toBe(false);
  });

  test("throws when input exceeds limit", () => {
    expect(() => safeTest(/./, "a".repeat(100), 10)).toThrow(/Input too long/);
  });
});

describe("safeExec", () => {
  test("returns exec result for valid input", () => {
    const m = safeExec(/world/, "hello world");
    expect(m).not.toBeNull();
    expect(m![0]).toBe("world");
  });

  test("returns null for non-matching valid input", () => {
    expect(safeExec(/xyz/, "hello world")).toBeNull();
  });

  test("throws when input exceeds limit", () => {
    expect(() => safeExec(/./, "a".repeat(100), 10)).toThrow(/Input too long/);
  });
});

describe("safeMatch", () => {
  test("returns match result for valid input", () => {
    const m = safeMatch("hello world", /world/);
    expect(m).not.toBeNull();
    expect(m![0]).toBe("world");
  });

  test("returns null for non-matching valid input", () => {
    expect(safeMatch("hello world", /xyz/)).toBeNull();
  });

  test("throws when input exceeds limit", () => {
    expect(() => safeMatch("a".repeat(100), /./, 10)).toThrow(/Input too long/);
  });
});

describe("safeReplace", () => {
  test("returns replaced result for valid input", () => {
    expect(safeReplace("hello world", /world/, "earth")).toBe("hello earth");
  });

  test("passes through unchanged when no match", () => {
    expect(safeReplace("hello", /xyz/, "abc")).toBe("hello");
  });

  test("throws when input exceeds limit", () => {
    expect(() => safeReplace("a".repeat(100), /./g, "b", 10)).toThrow(/Input too long/);
  });
});

describe("safeSplit", () => {
  test("returns split result for valid input", () => {
    expect(safeSplit("a b c", /\s+/)).toEqual(["a", "b", "c"]);
  });

  test("respects limit parameter", () => {
    expect(safeSplit("a b c d", /\s+/, 2)).toEqual(["a", "b"]);
  });

  test("throws when input exceeds limit", () => {
    expect(() => safeSplit("a".repeat(100), /./, undefined, 10)).toThrow(/Input too long/);
  });
});

describe("guarded functions preserve regex semantics", () => {
  test("global replace works correctly", () => {
    expect(safeReplace("a1 b2 c3", /\d/g, "#")).toBe("a# b# c#");
  });

  test("replace with function replacer works", () => {
    expect(safeReplace("hello world", /\w+/g, (s) => s.toUpperCase())).toBe("HELLO WORLD");
  });

  test("exec with capture groups", () => {
    const m = safeExec(/(\d+)/, "abc 123 def");
    expect(m).not.toBeNull();
    expect(m![1]).toBe("123");
  });

  test("match with g flag returns all matches", () => {
    const m = safeMatch("a1 b2 c3", /\d/g);
    expect(m).toEqual(["1", "2", "3"]);
  });

  test("empty input does not throw", () => {
    expect(guardRegexInput("")).toBe("");
    expect(safeTest(/.*/, "")).toBe(true);
    expect(safeExec(/.*/, "")![0]).toBe("");
    expect(safeMatch("", /.*/)![0]).toBe("");
    expect(safeReplace("", /a/g, "b")).toBe("");
    expect(safeSplit("", /,/, undefined, 100)).toEqual([""]);
  });
});

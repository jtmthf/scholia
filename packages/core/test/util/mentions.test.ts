import { describe, test, expect } from "vitest";
import { parseMentions, mentionsMatch } from "@scholia/core";

// Unit tests for @-mention parsing + matching (M7, CONTEXT "Mention"). No DB.

describe("parseMentions", () => {
  test("extracts a single mention", () => {
    expect(parseMentions("hello @alice")).toEqual(["alice"]);
  });

  test("extracts multiple distinct mentions", () => {
    expect(parseMentions("@alice and @bob please review")).toEqual(["alice", "bob"]);
  });

  test("deduplicates case-insensitively, preserves first-seen casing", () => {
    expect(parseMentions("@Alice check, @alice again, @ALICE one more")).toEqual(["Alice"]);
  });

  test("ignores email-style patterns (a@b)", () => {
    expect(parseMentions("email user@example.com here")).toEqual([]);
  });

  test("handles hyphenated handles", () => {
    expect(parseMentions("ping @owner-agent for this")).toEqual(["owner-agent"]);
  });

  test("handles mention at start of string", () => {
    expect(parseMentions("@reviewer please look")).toEqual(["reviewer"]);
  });

  test("handles mention after punctuation", () => {
    expect(parseMentions("done! @alice")).toEqual(["alice"]);
  });

  test("returns empty for body with no mentions", () => {
    expect(parseMentions("just a regular comment")).toEqual([]);
  });

  test("returns empty for empty string", () => {
    expect(parseMentions("")).toEqual([]);
  });

  test("mixed email and valid mention", () => {
    expect(parseMentions("from user@host.com, cc @alice")).toEqual(["alice"]);
  });

  test("handle with underscores and digits", () => {
    expect(parseMentions("cc @user_42 on this")).toEqual(["user_42"]);
  });
});

describe("mentionsMatch", () => {
  test("exact match is case-insensitive", () => {
    expect(mentionsMatch("alice", "Alice")).toBe(true);
    expect(mentionsMatch("Alice", "alice")).toBe(true);
  });

  test("slug-normalizes: spaces → hyphens (possessive 's dropped)", () => {
    // "Owner's agent" → drop "'s" → "owner agent" → "owner-agent"
    expect(mentionsMatch("owner-agent", "Owner's agent")).toBe(true);
  });

  test("possessive 's is dropped, not kept: 'owners' form does not match", () => {
    expect(mentionsMatch("owners-agent", "Owner's agent")).toBe(false);
  });

  test("hyphenated handle matches display name with spaces (possessive 's dropped)", () => {
    // "Owner's agent" → drop possessive "'s" → "owner agent" → "owner-agent"
    expect(mentionsMatch("owner-agent", "Owner's agent")).toBe(true);
  });

  test("@owners-agent (with s) does NOT match — possessive 's is dropped, not kept", () => {
    expect(mentionsMatch("owners-agent", "Owner's agent")).toBe(false);
  });

  test("non-matching names return false", () => {
    expect(mentionsMatch("alice", "bob")).toBe(false);
  });

  test("partial match returns false", () => {
    expect(mentionsMatch("ali", "alice")).toBe(false);
  });

  test("same string always matches", () => {
    expect(mentionsMatch("review-bot", "review-bot")).toBe(true);
  });
});

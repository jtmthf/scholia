// Reading a verb's arguments (ADR-0021).
//
// Both surfaces hand over an untyped bag — cac produces one from flags, MCP
// from JSON — and this is where it becomes typed, once, for both. So the shapes
// tested here are the ones those two actually produce: a repeated flag that
// arrives as a bare string, a `--kebab-case` key beside its camelCase twin, a
// boolean that is present rather than true.

import { describe, test, expect } from "vitest";
import { readInput, readParam, toFlagName, VerbInputError, type VerbParam } from "@scholia/core";

const body: VerbParam = {
  name: "body",
  type: "string",
  required: true,
  description: "The comment text.",
};

describe("readParam", () => {
  test("applies the default when the surface passed nothing", () => {
    const page: VerbParam = { name: "page", type: "string", description: "…", default: "." };
    expect(readParam({}, page)).toBe(".");
    expect(readParam({ page: "guide.md" }, page)).toBe("guide.md");
  });

  test("names the flag when a required param is missing", () => {
    expect(() => readParam({}, body)).toThrow(VerbInputError);
    expect(() => readParam({}, body)).toThrow("--body is required");
  });

  test("an optional string left out reads as empty, not as a failure", () => {
    expect(readParam({}, { name: "summary", type: "string", description: "…" })).toBe("");
  });

  test("a boolean is false unless it is there", () => {
    const chat: VerbParam = { name: "chat", type: "boolean", description: "…" };
    expect(readParam({}, chat)).toBe(false);
    expect(readParam({ chat: true }, chat)).toBe(true);
    // cac hands strings back for `--chat=true`.
    expect(readParam({ chat: "true" }, chat)).toBe(true);
  });

  test("a list takes one value or many, because cac gives both", () => {
    const comment: VerbParam = { name: "comment", type: "string[]", description: "…" };
    expect(readParam({ comment: "a" }, comment)).toEqual(["a"]);
    expect(readParam({ comment: ["a", "b"] }, comment)).toEqual(["a", "b"]);
    expect(readParam({}, comment)).toEqual([]);
  });

  test("a required list has to have something in it", () => {
    const comment: VerbParam = {
      name: "comment",
      type: "string[]",
      required: true,
      description: "…",
    };
    expect(() => readParam({ comment: [] }, comment)).toThrow("--comment is required");
  });

  test("a value outside a closed set is refused with the set", () => {
    const state: VerbParam = {
      name: "state",
      type: "string",
      description: "…",
      choices: ["open", "closed"],
    };
    expect(readParam({ state: "open" }, state)).toBe("open");
    expect(() => readParam({ state: "ajar" }, state)).toThrow("must be one of open, closed");
  });

  // cac keeps `--page-path` alongside `pagePath`; MCP only ever sends the
  // camelCase name. Reading both means neither surface has to normalize.
  test("the kebab-case key is read too", () => {
    const param: VerbParam = { name: "pagePath", type: "string", description: "…" };
    expect(toFlagName("pagePath")).toBe("page-path");
    expect(readParam({ "page-path": "guide.md" }, param)).toBe("guide.md");
  });

  test("an explicit null reads as absent — cac's shape for a flag with no value", () => {
    expect(
      readParam({ summary: null }, { name: "summary", type: "string", description: "…" }),
    ).toBe("");
  });
});

test("readInput reads every param a verb declares, and only those", () => {
  const values = readInput([body, { name: "chat", type: "boolean", description: "…" }], {
    body: "hello",
    unrelated: "ignored",
  });
  expect(values).toEqual({ body: "hello", chat: false });
});

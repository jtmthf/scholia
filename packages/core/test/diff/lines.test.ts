import { describe, test, expect } from "vitest";
import { diffLines } from "../../src/diff/lines.js";

describe("diffLines", () => {
  test("identical sources are unchanged with only context lines", () => {
    const src = "a\nb\nc\n";
    const d = diffLines(src, src);
    expect(d.unchanged).toBe(true);
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
    expect(d.lines.every((l) => l.type === "context")).toBe(true);
  });

  test("a single changed line is one del + one add with gutter numbers", () => {
    const d = diffLines("a\nb\nc\n", "a\nB\nc\n");
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    const del = d.lines.find((l) => l.type === "del")!;
    const add = d.lines.find((l) => l.type === "add")!;
    expect(del).toMatchObject({ oldLine: 2, text: "b" });
    expect(add).toMatchObject({ newLine: 2, text: "B" });
    expect(del.newLine).toBeUndefined();
    expect(add.oldLine).toBeUndefined();
  });

  test("pure insertion at the end", () => {
    const d = diffLines("a\nb\n", "a\nb\nc\n");
    expect(d.added).toBe(1);
    expect(d.removed).toBe(0);
    expect(d.lines.at(-1)).toMatchObject({ type: "add", newLine: 3, text: "c" });
  });

  test("pure deletion", () => {
    const d = diffLines("a\nb\nc\n", "a\nc\n");
    expect(d.added).toBe(0);
    expect(d.removed).toBe(1);
    expect(d.lines.find((l) => l.type === "del")).toMatchObject({ oldLine: 2, text: "b" });
  });

  test("trailing newline does not create a phantom empty line", () => {
    const d = diffLines("a\n", "a\n");
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0]).toMatchObject({ type: "context", text: "a" });
  });

  test("empty vs non-empty", () => {
    const d = diffLines("", "x\ny\n");
    expect(d.removed).toBe(0);
    expect(d.added).toBe(2);
    expect(d.lines.map((l) => l.text)).toEqual(["x", "y"]);
  });

  test("line numbering stays consistent across a mixed hunk", () => {
    const d = diffLines("one\ntwo\nthree\n", "one\ntwo-b\nthree\nfour\n");
    // one(ctx), two->two-b (del+add), three(ctx), four(add)
    const ctxThree = d.lines.find((l) => l.text === "three")!;
    expect(ctxThree).toMatchObject({ type: "context", oldLine: 3, newLine: 3 });
    const four = d.lines.find((l) => l.text === "four")!;
    expect(four).toMatchObject({ type: "add", newLine: 4 });
  });
});

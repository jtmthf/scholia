import { describe, test, expect } from "vitest";
import { mapSmIdsToSourceRange } from "../../src/anchor/source-range.js";
import type { SourceMap } from "../../src/ingest/source-map.js";

const SOURCE_MAP_VERSION = 1 as const;

/** Build a minimal SourceMap from a list of [id, start, end] tuples. */
function makeSourceMap(entries: Array<[id: number, start: number, end: number]>): SourceMap {
  return {
    version: SOURCE_MAP_VERSION,
    entries: entries.map(([id, start, end]) => ({ id, tag: "p", start, end })),
  };
}

describe("mapSmIdsToSourceRange", () => {
  test("returns the entry's own range for a single id", () => {
    const sm = makeSourceMap([[0, 10, 20]]);
    expect(mapSmIdsToSourceRange([0], sm)).toEqual({ start: 10, end: 20 });
  });

  test("returns min-start/max-end across multiple ids", () => {
    const sm = makeSourceMap([
      [0, 5, 15],
      [1, 20, 30],
      [2, 12, 18],
    ]);
    // min start = 5 (entry 0), max end = 30 (entry 1)
    expect(mapSmIdsToSourceRange([0, 1, 2], sm)).toEqual({ start: 5, end: 30 });
  });

  test("ignores ids not present in the source map", () => {
    const sm = makeSourceMap([[3, 40, 60]]);
    expect(mapSmIdsToSourceRange([3, 99], sm)).toEqual({ start: 40, end: 60 });
  });

  test("returns undefined when smIds is empty", () => {
    const sm = makeSourceMap([[0, 0, 10]]);
    expect(mapSmIdsToSourceRange([], sm)).toBeUndefined();
  });

  test("returns undefined when all ids are unknown", () => {
    const sm = makeSourceMap([[0, 0, 10]]);
    expect(mapSmIdsToSourceRange([7, 8, 9], sm)).toBeUndefined();
  });

  test("returns undefined when source map has no entries and smIds is provided", () => {
    const sm: SourceMap = { version: SOURCE_MAP_VERSION, entries: [] };
    expect(mapSmIdsToSourceRange([0], sm)).toBeUndefined();
  });

  test("handles a single id correctly when entries are not sorted by id", () => {
    const sm = makeSourceMap([
      [5, 100, 200],
      [2, 50, 80],
    ]);
    expect(mapSmIdsToSourceRange([2], sm)).toEqual({ start: 50, end: 80 });
  });

  test("two adjacent ids produce the union span", () => {
    const sm = makeSourceMap([
      [0, 0, 50],
      [1, 50, 100],
    ]);
    expect(mapSmIdsToSourceRange([0, 1], sm)).toEqual({ start: 0, end: 100 });
  });
});

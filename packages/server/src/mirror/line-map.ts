// Map a Scholia Anchor's source range (char offsets in the canonical source) to a
// 1-based line range at the PR head commit, for GitHub review-comment placement.
// GitHub's `line` parameter is 1-based and refers to the right side of the diff;
// we use the END line so a multi-line selection lands on its closing line.

import type { SourceRange } from "@scholia/core";

export interface LineRange {
  startLine: number;
  endLine: number;
  side: "RIGHT";
}

// Count `\n` occurrences before each offset + 1 → 1-based line. Empty source is
// line 1. A range spanning nothing (`start === end`) collapses to one line.
export function sourceRangeToLines(source: Uint8Array | string, range: SourceRange): LineRange {
  const text = typeof source === "string" ? source : new TextDecoder().decode(source);
  const startLine = lineAt(text, clamp(range.start, 0, text.length));
  const endLine = lineAt(text, clamp(range.end - 1, range.start, text.length - 1));
  return {
    startLine: Math.min(startLine, endLine) || 1,
    endLine: Math.max(startLine, endLine) || 1,
    side: "RIGHT",
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// 1-based line number of the line containing the character at offset `i`.
function lineAt(text: string, i: number): number {
  if (i < 0) return 1;
  let line = 1;
  for (let k = 0; k < i && k < text.length; k++) {
    if (text.charCodeAt(k) === 0x0a) line += 1;
  }
  return line;
}
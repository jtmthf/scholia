// Source-level line diff (M6, CONTEXT "Diff"). A per-Page comparison between two
// Versions' canonical source, shown in the viewer (default: Last Seen vs Latest)
// and offered via the API alongside `list_versions`. v1 does not overlay diffs on
// the rendered page — this is a plain, source-level, line-based diff.
//
// Dependency-free: a classic Myers/LCS line diff over the two sources. The DiffLine
// stream is directly renderable (unified style) and carries 1-based line numbers on
// each side for gutter display. Kept in `@collab/core` (pure, unit-tested) since
// diff correctness is a high-value target (PLAN §7).

export type DiffLineType = "context" | "add" | "del";

export interface DiffLine {
  type: DiffLineType;
  /** 1-based line number in the OLD source (undefined for an added line). */
  oldLine?: number;
  /** 1-based line number in the NEW source (undefined for a deleted line). */
  newLine?: number;
  text: string;
}

export interface LineDiff {
  lines: DiffLine[];
  added: number;
  removed: number;
  /** True when the two sources are byte-identical (no changes). */
  unchanged: boolean;
}

// Split into lines WITHOUT a trailing empty element for a final newline, so a
// file ending in "\n" doesn't diff as having a phantom last line. An empty file
// yields zero lines.
function splitLines(src: string): string[] {
  if (src === "") return [];
  const lines = src.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

// Longest-common-subsequence table over lines, then a standard backtrace into a
// unified add/del/context stream.
export function diffLines(oldSrc: string, newSrc: string): LineDiff {
  const a = splitLines(oldSrc);
  const b = splitLines(newSrc);
  const n = a.length;
  const m = b.length;

  // lcs[i][j] = LCS length of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ type: "context", oldLine: i + 1, newLine: j + 1, text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      lines.push({ type: "del", oldLine: i + 1, text: a[i]! });
      removed++;
      i++;
    } else {
      lines.push({ type: "add", newLine: j + 1, text: b[j]! });
      added++;
      j++;
    }
  }
  while (i < n) {
    lines.push({ type: "del", oldLine: i + 1, text: a[i]! });
    removed++;
    i++;
  }
  while (j < m) {
    lines.push({ type: "add", newLine: j + 1, text: b[j]! });
    added++;
    j++;
  }

  return { lines, added, removed, unchanged: added === 0 && removed === 0 };
}

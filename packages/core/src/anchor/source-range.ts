import type { SourceMap } from "../ingest/source-map.js";
import type { SourceRange } from "./types.js";

// Map the `data-sm` ids a selection intersects to a coarse character range in the
// canonical source, using the page's stored Source Map. Block-granular and
// best-effort (the source range is a SECONDARY hint per ADR-0002); the span is
// the min start / max end of the referenced entries. Returns undefined when no
// id resolves.
export function mapSmIdsToSourceRange(
  smIds: number[],
  sourceMap: SourceMap,
): SourceRange | undefined {
  if (smIds.length === 0) return undefined;

  // Build a lookup map from id to entry for O(n) resolution.
  const byId = new Map(sourceMap.entries.map((e) => [e.id, e]));

  let minStart: number | undefined;
  let maxEnd: number | undefined;

  for (const id of smIds) {
    const entry = byId.get(id);
    if (entry === undefined) continue;

    if (minStart === undefined || entry.start < minStart) minStart = entry.start;
    if (maxEnd === undefined || entry.end > maxEnd) maxEnd = entry.end;
  }

  if (minStart === undefined || maxEnd === undefined) return undefined;

  return { start: minStart, end: maxEnd };
}

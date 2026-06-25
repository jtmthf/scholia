// The Source Map (CONTEXT "Source Map", ADR-0003): the mapping from a rendered
// Markdown Page back to character ranges in the original markdown source. It is
// produced at render time and stored as a blob alongside the rendered HTML, so
// the bridge (M5) can turn a selection in the content iframe into a source range.
//
// Each rendered element that still carries a source `position` is stamped with a
// `data-sm` id, and that id maps to the element's start/end **character offsets**
// in the source string. Offsets (not just line/col) are used so anchoring can run
// against the source string directly.
import { visit } from "unist-util-visit";

export const SOURCE_MAP_VERSION = 1 as const;
export const SOURCE_MAP_ATTR = "data-sm";

export interface SourceMapEntry {
  /** Stable id stamped onto the rendered element as `data-sm`. */
  id: number;
  /** Element tag name, e.g. "p", "h1", "li" — a coarse hint for resolution. */
  tag: string;
  /** Inclusive start character offset in the source. */
  start: number;
  /** Exclusive end character offset in the source. */
  end: number;
}

export interface SourceMap {
  version: typeof SOURCE_MAP_VERSION;
  entries: SourceMapEntry[];
}

// Rehype plugin: walk the tree before any rewriting passes (slug, shiki) mangle
// positions, stamp each positioned element with a `data-sm` id, and collect the
// id -> source-offset map into `entries`. Best-effort: elements a plugin has
// synthesized (no `position`) are simply skipped.
export function rehypeSourceMap(entries: SourceMapEntry[]) {
  return (tree: any) => {
    visit(tree, "element", (node: any) => {
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      if (start == null || end == null) return;
      const id = entries.length;
      node.properties = node.properties ?? {};
      node.properties[SOURCE_MAP_ATTR] = String(id);
      entries.push({ id, tag: node.tagName, start, end });
    });
  };
}

export function serializeSourceMap(entries: SourceMapEntry[]): SourceMap {
  return { version: SOURCE_MAP_VERSION, entries };
}

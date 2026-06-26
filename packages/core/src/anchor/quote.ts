import type { TextQuote } from "./types.js";

// Search a plain-text string for a UNIQUE occurrence of a text-quote (ADR-0002:
// uniqueness by construction — no occurrence ordinals). Returns the [start,end)
// char range of `exact` only when the quote (with its prefix/suffix context)
// matches exactly one location; returns null on zero or multiple matches so the
// caller can mark the Conversation Outdated rather than anchor to the wrong span.
//
// This is the canonical string matcher reused by cross-Version migration (M6).
// In M5 the iframe captures/expands the quote against the rendered DOM (via
// dom-anchor-text-quote); this function is the pure, server-side/string-side
// equivalent and the migration key.
export function searchQuote(
  text: string,
  quote: TextQuote,
): { start: number; end: number } | null {
  const { exact, prefix, suffix } = quote;

  // Empty exact string cannot anchor to anything meaningful.
  if (exact.length === 0) return null;

  const qualifying: Array<{ start: number; end: number }> = [];
  let searchFrom = 0;

  while (searchFrom <= text.length - exact.length) {
    const idx = text.indexOf(exact, searchFrom);
    if (idx === -1) break;

    const end = idx + exact.length;

    // Check prefix: compare what is available before `idx` against the tail of
    // `prefix`. If the full prefix doesn't fit, we compare against the available
    // leading text using endsWith semantics (tolerant boundary handling).
    if (prefix !== undefined && prefix.length > 0) {
      const available = text.slice(0, idx);
      if (!available.endsWith(prefix)) {
        searchFrom = idx + 1;
        continue;
      }
    }

    // Check suffix: compare what is available after `end` against the head of
    // `suffix`. If the full suffix doesn't fit, we compare against the available
    // trailing text using startsWith semantics (tolerant boundary handling).
    if (suffix !== undefined && suffix.length > 0) {
      const available = text.slice(end);
      if (!available.startsWith(suffix)) {
        searchFrom = idx + 1;
        continue;
      }
    }

    qualifying.push({ start: idx, end });
    searchFrom = idx + 1;
  }

  // Uniqueness by construction (ADR-0002): exactly one qualifying match required.
  return qualifying.length === 1 ? qualifying[0]! : null;
}

// PROTOTYPE (issue #24) — PORTABLE. Pure uniqueness expansion.
//
// The iframe has `buildUniqueQuote` (packages/bridge/src/iframe/entry.ts) but it
// is DOM-bound, so there is no way to (re-)capture a uniquely-expanded quote
// server-side. Incremental re-anchoring needs exactly that. This mirrors the
// iframe's policy verbatim — 32-char context doubling to a 200 cap — so quotes
// produced here are indistinguishable from ones a real selection would produce.
//
// Lift target: packages/core/src/anchor/expand.ts
import type { TextQuote } from "../src/anchor/types.js";

const START_CONTEXT = 32;
const MAX_CONTEXT = 200;

function countOccurrences(text: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

/**
 * Expand prefix/suffix context around `text[start, end)` until the quote is
 * unique within `text`. Mirrors the iframe's `buildUniqueQuote`, including its
 * habit of attaching context even when `exact` is already unique.
 */
export function expandToUnique(text: string, start: number, end: number): TextQuote {
  const exact = text.slice(start, end);
  let ctxLen = START_CONTEXT;

  for (;;) {
    const prefix = text.slice(Math.max(0, start - ctxLen), start);
    const suffix = text.slice(end, Math.min(text.length, end + ctxLen));

    if (countOccurrences(text, exact) <= 1) {
      return { exact, prefix: prefix || undefined, suffix: suffix || undefined };
    }
    if (countOccurrences(text, prefix + exact + suffix) <= 1) {
      return { exact, prefix: prefix || undefined, suffix: suffix || undefined };
    }
    if (ctxLen >= MAX_CONTEXT) {
      // Exhausted — best effort at the cap, same as the iframe.
      return {
        exact,
        prefix: text.slice(Math.max(0, start - MAX_CONTEXT), start) || undefined,
        suffix: text.slice(end, Math.min(text.length, end + MAX_CONTEXT)) || undefined,
      };
    }
    ctxLen = Math.min(ctxLen * 2, MAX_CONTEXT);
  }
}

/**
 * Same expansion, but only attaches context when it is actually needed to
 * disambiguate. Not a strategy under test — used to attribute *why* a migration
 * failed (see strategies.ts `attribute`).
 */
export function expandMinimal(text: string, start: number, end: number): TextQuote {
  const exact = text.slice(start, end);
  if (countOccurrences(text, exact) <= 1) return { exact };
  return expandToUnique(text, start, end);
}

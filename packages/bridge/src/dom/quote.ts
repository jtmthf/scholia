// Uniqueness expansion for a captured text-quote (ADR-0002, CONTEXT "Anchor").
//
// The only part of selection capture that touches no DOM, which is why it lives
// on its own: it is the rule that decides what an Anchor *is*, and it is tested
// directly rather than through a browser.

/** Structural — not imported at runtime, so no package ends up in the bundle. */
export interface TextQuote {
  exact: string;
  prefix?: string;
  suffix?: string;
}

/** How far context is grown before expansion gives up. */
export const MAX_CONTEXT = 200;

/** Literal, case-sensitive, non-overlapping occurrences of `needle` in `text`. */
export function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length || 1;
  }
  return count;
}

/**
 * Build the text-quote for a selection, expanding prefix/suffix context until
 * the quote identifies one span of `documentText` and no other.
 *
 * Context is included even when `exact` is already unique: it costs nothing at
 * capture time and is what lets a later re-resolution disambiguate if the text
 * around the passage acquires a copy of it.
 *
 * Expansion is bounded at {@link MAX_CONTEXT}. A quote that is still ambiguous
 * there is returned anyway, which is a known hole — see issue #71; it does not
 * fire on prose, only on the kind of verbatim repetition generated reference
 * docs are made of.
 */
export function buildUniqueQuote(
  exact: string,
  documentText: string,
  selStart: number,
  selEnd: number,
): TextQuote {
  const contextAt = (length: number): { prefix: string; suffix: string } => ({
    prefix: documentText.substring(Math.max(0, selStart - length), selStart),
    suffix: documentText.substring(selEnd, Math.min(documentText.length, selEnd + length)),
  });

  // An empty string is not a constraint — omit the field rather than write one
  // that says nothing (the selection was at the start or end of the document).
  const quote = (prefix: string, suffix: string): TextQuote => ({
    exact,
    ...(prefix ? { prefix } : {}),
    ...(suffix ? { suffix } : {}),
  });

  const alreadyUnique = countOccurrences(documentText, exact) <= 1;

  // Start at the library's 32-character default and double until unique.
  for (let length = 32; length <= MAX_CONTEXT; length = Math.min(length * 2, MAX_CONTEXT)) {
    const { prefix, suffix } = contextAt(length);
    if (alreadyUnique || countOccurrences(documentText, prefix + exact + suffix) <= 1) {
      return quote(prefix, suffix);
    }
    if (length >= MAX_CONTEXT) break;
  }

  const { prefix, suffix } = contextAt(MAX_CONTEXT);
  return quote(prefix, suffix);
}

// Anchoring types (M5, ADR-0002). The Anchor binds a Conversation to a span of a
// Page. Its PRIMARY form is a text-quote (exact + prefix/suffix context) that is
// expanded to be UNIQUE within the rendered document at capture time; structural
// hints (source range, xpath/css) are SECONDARY. The text-quote is captured and
// uniquely expanded in the content iframe against the rendered DOM; the source
// range is derived server-side by mapping the selection's `data-sm` ids through
// the stored Source Map (the untrusted iframe never receives the Source Map).
//
// These are the canonical anchoring types. `@collab/db` keeps its own structurally
// identical jsonb shapes for the `anchor` column (schema.ts); the server bridges
// between them (they are interchangeable under TS structural typing).

export interface TextQuote {
  /** The exact selected text. */
  exact: string;
  /** Leading context, expanded until the quote is unique within the document. */
  prefix?: string;
  /** Trailing context, expanded until the quote is unique within the document. */
  suffix?: string;
}

export interface SourceRange {
  /** Inclusive start character offset in the canonical source. */
  start: number;
  /** Exclusive end character offset in the canonical source. */
  end: number;
}

export interface Anchor {
  /** Primary, authoritative locator (ADR-0002). */
  textQuote: TextQuote;
  /** Secondary: best-effort character range in the canonical source. */
  sourceRange?: SourceRange;
  /** Secondary: XPath to the containing element (HTML Pages). */
  xpath?: string;
  /** Secondary: CSS selector for the containing element (HTML Pages). */
  css?: string;
}

// What the content iframe captures for a fresh selection and posts up to the
// parent. The text-quote is already uniquely expanded against the rendered DOM;
// `smIds` are the `data-sm` ids the selection intersects, which the server maps
// to a `sourceRange` via the page's stored Source Map.
export interface SelectionCandidate {
  quote: TextQuote;
  smIds: number[];
  xpath?: string;
  css?: string;
}

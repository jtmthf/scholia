// The Hypothesis text-quote library, given a type.
//
// `dom-anchor-text-quote` ships no declarations. An ambient `declare module`
// would work inside this package but not in a consumer's own program, and a
// triple-slash reference to one is the wrong shape for a module the package
// entry point re-exports. So the untyped import is confined to this file, and
// everything else in ./dom imports from here.
//
// The signatures are narrowed to what we actually call, deliberately: the library
// takes an options bag with a position hint we never pass, and a type that
// promised more than the callers use would be a type that lies by omission.

// @ts-expect-error — no bundled or DefinitelyTyped declarations for this package.
import * as textQuote from "dom-anchor-text-quote";

/** A text-quote selector as the library models it (ADR-0002's primary form). */
export interface TextQuoteSelector {
  exact: string;
  prefix?: string;
  suffix?: string;
}

const lib = textQuote as {
  fromRange(root: Node, range: Range): TextQuoteSelector;
  toRange(root: Node, selector: TextQuoteSelector): Range | null;
};

/** The quote a Range describes, with the library's default context width. */
export function fromRange(root: Node, range: Range): TextQuoteSelector {
  return lib.fromRange(root, range);
}

/** The Range a quote resolves to in `root`, or null when it no longer matches. */
export function toRange(root: Node, selector: TextQuoteSelector): Range | null {
  return lib.toRange(root, selector);
}

// Ambient declarations for the Hypothesis dom-anchor libraries (no bundled types).
// Only the surface the iframe entry uses (PLAN §1 anchoring lineage).
declare module "dom-anchor-text-quote" {
  export interface TextQuoteSelector {
    exact: string;
    prefix?: string;
    suffix?: string;
  }
  export function fromRange(root: Node, range: Range): TextQuoteSelector;
  export function toRange(
    root: Node,
    selector: TextQuoteSelector,
    options?: { hint?: number },
  ): Range | null;
  export function fromTextPosition(
    root: Node,
    selector: { start: number; end: number },
  ): TextQuoteSelector;
}

declare module "dom-anchor-text-position" {
  export interface TextPositionSelector {
    start: number;
    end: number;
  }
  export function fromRange(root: Node, range: Range): TextPositionSelector;
  export function toRange(root: Node, selector: TextPositionSelector): Range;
}

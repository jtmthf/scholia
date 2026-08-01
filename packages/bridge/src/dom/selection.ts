// Turning a reader's selection into an Anchor candidate, against whatever DOM
// the Page content happens to live in.
//
// Two surfaces call this and they are shaped differently: hosted, the content is
// a sandboxed cross-origin document and the candidate is posted to the parent
// (ADR-0003); locally, the content is an element in the chrome document itself
// and the candidate is used in place. The difference is entirely in the plumbing
// around the capture, so the capture takes a root element and knows nothing else.
//
// The quote is captured from *rendered* text on both paths, which is what makes
// one matcher serve both (ADR-0029 "anchors resolve against rendered text").
//
// IMPORTANT: do NOT write the literal string </script> anywhere in this file —
// it is bundled into the inlined content script.

import { fromRange } from "./dom-anchor.js";
import { buildUniqueQuote, type TextQuote } from "./quote.js";

/**
 * What a fresh selection yields. Structurally identical to `@scholia/core`'s
 * `SelectionCandidate`, declared here so nothing from core reaches the bundle.
 */
export interface SelectionCandidate {
  quote: TextQuote;
  /** The `data-sm` ids the selection intersects — the Source Map's input. */
  smIds: number[];
  xpath?: string;
  css?: string;
}

export interface CapturedSelection {
  candidate: SelectionCandidate;
  /** The live Range, for callers that need to position something over it. */
  range: Range;
}

// A selection's offset in the root's textContent — the coordinate system
// `buildUniqueQuote` works in, since that is the string a quote is searched for.
function offsetWithin(root: Element, container: Node, offset: number): number {
  const probe = root.ownerDocument.createRange();
  probe.setStart(root, 0);
  probe.setEnd(container, offset);
  return probe.toString().length;
}

/** `data-sm` ids of every stamped element the range touches, in document order. */
function intersectedSmIds(root: Element, range: Range): number[] {
  const ids: number[] = [];
  for (const el of Array.from(root.querySelectorAll("[data-sm]"))) {
    if (!range.intersectsNode(el)) continue;
    const id = Number(el.getAttribute("data-sm"));
    if (!Number.isNaN(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * The path from the document element down to `el`, one segment per ancestor.
 *
 * XPath and a CSS selector are the same walk written two ways — same ancestors,
 * same same-tag sibling index, differing only in how a segment is spelled. The
 * index is omitted where the element is its parent's only child of that tag,
 * which keeps both forms readable on the common case.
 */
function ancestorPath(
  el: Element,
  segment: (tag: string, index: number | null) => string,
): string[] {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== el.ownerDocument.documentElement) {
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    const tag = node.tagName;
    const sameTag = Array.from(parent.children).filter((c: Element) => c.tagName === tag);
    const index = sameTag.length > 1 ? sameTag.indexOf(node) + 1 : null;
    parts.unshift(segment(tag.toLowerCase(), index));
    node = parent;
  }
  return parts;
}

function getXPath(el: Element): string {
  const parts = ancestorPath(el, (tag, index) => (index === null ? tag : `${tag}[${index}]`));
  parts.unshift("html");
  return "/" + parts.join("/");
}

function getCssSelector(el: Element): string {
  // An id is unique in the document, so the walk is unnecessary work.
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts = ancestorPath(el, (tag, index) =>
    index === null ? tag : `${tag}:nth-of-type(${index})`,
  );
  return parts.join(" > ");
}

// Best-effort structural hints for the containing element (ADR-0002: secondary,
// never authoritative). Never throws — a missing hint costs nothing.
function structuralHints(root: Element, range: Range): { xpath?: string; css?: string } {
  try {
    let ancestor: Node | null = range.commonAncestorContainer;
    if (ancestor.nodeType === 3 /* TEXT_NODE */) ancestor = ancestor.parentElement;
    if (!(ancestor instanceof Element) || ancestor === root) return {};
    return { xpath: getXPath(ancestor), css: getCssSelector(ancestor) };
  } catch {
    return {};
  }
}

/**
 * Capture the current selection inside `root` as an Anchor candidate, or null
 * when there is nothing selected inside it.
 *
 * `selection` is passed in rather than read from a global because the selection
 * that matters belongs to `root`'s own document, which is not necessarily the
 * caller's.
 */
export function captureSelection(
  root: Element,
  selection: Selection | null,
): CapturedSelection | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (range.collapsed || range.toString().trim() === "") return null;
  // A selection that started outside the content is not a selection *of* the
  // content — the reader dragged across the chrome.
  if (!root.contains(range.commonAncestorContainer)) return null;

  // `fromRange` gives the exact text plus the library's default context; the
  // context is then rebuilt to whatever width uniqueness actually requires.
  const libQuote = fromRange(root, range);
  const rootText = root.textContent ?? "";
  const selStart = offsetWithin(root, range.startContainer, range.startOffset);
  const quote = buildUniqueQuote(
    libQuote.exact,
    rootText,
    selStart,
    selStart + libQuote.exact.length,
  );

  return {
    candidate: {
      quote,
      smIds: intersectedSmIds(root, range),
      ...structuralHints(root, range),
    },
    range,
  };
}

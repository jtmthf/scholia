// Resolving stored Anchors into the rendered DOM and showing them there.
//
// Shared by the sandboxed content iframe (hosted) and the chrome document
// itself (Local Preview), so it is scoped to a root element and holds no
// globals. Resolution is `dom-anchor-text-quote` against rendered text, the same
// layer the quote was captured from (ADR-0029 "anchors resolve against rendered text").
//
// IMPORTANT: do NOT write the literal string </script> anywhere in this file —
// it is bundled into the inlined content script.

import { toRange } from "./dom-anchor.js";
import type { TextQuote } from "./quote.js";

const HIGHLIGHT_NAME = "scholia-anchor";
const HIGHLIGHT_STYLE =
  "::highlight(scholia-anchor){background-color:rgba(255,213,0,0.45);color:inherit;}";

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

/**
 * Every resolved Anchor in one root, keyed by Conversation id.
 *
 * Prefers the CSS Custom Highlight API, which paints ranges without touching the
 * document — the property that matters most, because the same DOM is what later
 * selections and re-resolutions are measured against. Where it is missing the
 * fallback wraps the range in a `<mark>`, which does mutate, and is best-effort
 * for exactly that reason.
 */
export class AnchorHighlights {
  private root: Element;
  private doc: Document;
  private ranges = new Map<string, Range>();
  private marks = new Map<string, Element>();
  private registry: HighlightRegistry | null;
  private HighlightCtor: (new (...ranges: Range[]) => unknown) | null;

  constructor(root: Element) {
    this.root = root;
    this.doc = root.ownerDocument;

    // The Highlight API is read off the root's *own* window, not a global: the
    // content may be in an iframe whose realm has different constructors.
    // Feature-detected rather than assumed — Chrome 105 / Safari 17.2 / FF 117.
    const win = this.doc.defaultView as unknown as
      | { CSS?: { highlights?: HighlightRegistry }; Highlight?: new (...r: Range[]) => unknown }
      | null
      | undefined;
    const registry = win?.CSS?.highlights;
    const ctor = win?.Highlight;
    this.registry = registry && ctor ? registry : null;
    this.HighlightCtor = this.registry && ctor ? ctor : null;

    if (this.registry) {
      const style = this.doc.createElement("style");
      style.textContent = HIGHLIGHT_STYLE;
      (this.doc.head || this.doc.documentElement).appendChild(style);
    }
  }

  /**
   * Resolve a stored quote against the current rendered text and paint it.
   * Returns the matched range, or null when the quote no longer matches — the
   * caller decides what that means (CONTEXT "Outdated").
   */
  resolve(id: string, quote: TextQuote): Range | null {
    this.remove(id);
    let range: Range | null = null;
    try {
      range = toRange(this.root, quote);
    } catch {
      range = null;
    }
    if (!range) return null;
    this.add(id, range);
    return range;
  }

  remove(id: string): void {
    this.ranges.delete(id);
    const mark = this.marks.get(id);
    if (mark) {
      const parent = mark.parentNode;
      if (parent) {
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        parent.removeChild(mark);
      }
      this.marks.delete(id);
    }
    this.repaint();
  }

  clear(): void {
    // Snapshotted first: `remove` mutates the map it would otherwise iterate.
    const ids = Array.from(this.ranges.keys());
    for (const id of ids) this.remove(id);
    this.registry?.delete(HIGHLIGHT_NAME);
  }

  /** The id of the topmost Anchor under a viewport point, or null. */
  hitTest(clientX: number, clientY: number): string | null {
    for (const [id, range] of this.ranges) {
      const rects = range.getClientRects();
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i]!;
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          return id;
        }
      }
    }
    return null;
  }

  scrollTo(id: string): void {
    const range = this.ranges.get(id);
    if (!range) return;
    const target = this.elementFor(range);
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  /**
   * Where an Anchor sits vertically within the document, for callers that order
   * or position something by it. Infinity when it isn't resolved, so unresolved
   * Anchors sort last rather than jumping to the top.
   */
  offsetTop(id: string): number {
    const range = this.ranges.get(id);
    if (!range) return Number.POSITIVE_INFINITY;
    const win = this.doc.defaultView;
    return range.getBoundingClientRect().top + (win?.scrollY ?? 0);
  }

  private elementFor(range: Range): Element | null {
    const container = range.startContainer;
    const el = container.nodeType === 3 ? container.parentElement : (container as Element);
    return el instanceof Element ? el : null;
  }

  private add(id: string, range: Range): void {
    this.ranges.set(id, range);
    if (this.registry) {
      this.repaint();
      return;
    }
    // Fallback: wrap the matched text so it is visible without the Highlight
    // API. This mutates the document, so it is deliberately the second choice.
    try {
      const mark = this.doc.createElement("mark");
      mark.setAttribute("data-scholia-anchor", id);
      mark.style.backgroundColor = "rgba(255,213,0,0.45)";
      mark.style.color = "inherit";
      mark.appendChild(range.cloneContents());
      range.deleteContents();
      range.insertNode(mark);
      this.marks.set(id, mark);
    } catch {
      // A range spanning element boundaries can't be wrapped — leave it
      // resolved but unpainted rather than damaging the content.
    }
  }

  private repaint(): void {
    if (!this.registry || !this.HighlightCtor) return;
    if (this.ranges.size === 0) {
      this.registry.delete(HIGHLIGHT_NAME);
      return;
    }
    this.registry.set(HIGHLIGHT_NAME, new this.HighlightCtor(...this.ranges.values()));
  }
}

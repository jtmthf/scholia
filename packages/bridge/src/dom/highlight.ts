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
const HIGHLIGHT_NAME_RESOLVED = "scholia-anchor-resolved";
const HIGHLIGHT_NAME_EMPHASIS = "scholia-anchor-emphasis";

// The light-mode open/resolved colors, shared with the DOM `<mark>` fallback
// below — one pair of values decides what "open" and "resolved" look like,
// rather than the CSS registration and the fallback drifting independently.
const COLOR_OPEN = "rgba(255,213,0,0.45)";
const COLOR_RESOLVED = "rgba(255,213,0,0.16)";

// Three registrations, not one: an open Conversation stays at full strength, a
// resolved one dims to a trace so a settled document doesn't accumulate
// permanent highlights (issue #109), and the emphasis layer is the one a
// hovered rail card lights up, painted above either. `:root.dark` — not
// `prefers-color-scheme` — because both hosts that inject this style (the
// hosted iframe and Local Preview's chrome document) toggle dark mode as an
// explicit class on their own root, driven by the reader's choice or the
// parent, not bare OS preference (see @scholia/bridge's iframe entry and
// Local Preview's THEME_BOOT).
const HIGHLIGHT_STYLE = `
::highlight(${HIGHLIGHT_NAME}) { background-color: ${COLOR_OPEN}; color: inherit; }
::highlight(${HIGHLIGHT_NAME_RESOLVED}) { background-color: ${COLOR_RESOLVED}; color: inherit; }
::highlight(${HIGHLIGHT_NAME_EMPHASIS}) { background-color: rgba(255,153,0,0.6); color: inherit; }
:root.dark ::highlight(${HIGHLIGHT_NAME}) { background-color: rgba(255,196,0,0.24); color: inherit; }
:root.dark ::highlight(${HIGHLIGHT_NAME_RESOLVED}) { background-color: rgba(255,196,0,0.09); color: inherit; }
:root.dark ::highlight(${HIGHLIGHT_NAME_EMPHASIS}) { background-color: rgba(255,163,26,0.42); color: inherit; }
`;

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
  private resolvedIds = new Set<string>();
  private emphasisId: string | null = null;
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
   * `resolved` is the owning Conversation's own resolved state (CONTEXT
   * "Resolved"), which decides which of the two base highlights the passage
   * joins. Returns the matched range, or null when the quote no longer
   * matches — the caller decides what that means (CONTEXT "Outdated").
   */
  resolve(id: string, quote: TextQuote, resolved = false): Range | null {
    this.remove(id);
    let range: Range | null = null;
    try {
      range = toRange(this.root, quote);
    } catch {
      range = null;
    }
    if (!range) return null;
    this.add(id, range, resolved);
    return range;
  }

  remove(id: string): void {
    this.ranges.delete(id);
    this.resolvedIds.delete(id);
    if (this.emphasisId === id) this.emphasisId = null;
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
    this.registry?.delete(HIGHLIGHT_NAME_RESOLVED);
    this.registry?.delete(HIGHLIGHT_NAME_EMPHASIS);
    this.emphasisId = null;
  }

  /**
   * Emphasize one resolved Anchor's passage — the passage-side half of hovering
   * its rail card — or clear the emphasis with null. A no-op id that isn't
   * currently resolved (already scrolled away, Outdated) simply paints nothing.
   */
  emphasize(id: string | null): void {
    this.emphasisId = id;
    this.repaintEmphasis();
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

  private add(id: string, range: Range, resolved: boolean): void {
    this.ranges.set(id, range);
    if (resolved) this.resolvedIds.add(id);
    if (this.registry) {
      this.repaint();
      return;
    }
    // Fallback: wrap the matched text so it is visible without the Highlight
    // API. This mutates the document, so it is deliberately the second choice.
    try {
      const mark = this.doc.createElement("mark");
      mark.setAttribute("data-scholia-anchor", id);
      mark.style.backgroundColor = resolved ? COLOR_RESOLVED : COLOR_OPEN;
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
    const open: Range[] = [];
    const resolved: Range[] = [];
    for (const [id, range] of this.ranges) {
      (this.resolvedIds.has(id) ? resolved : open).push(range);
    }
    if (open.length === 0) this.registry.delete(HIGHLIGHT_NAME);
    else this.registry.set(HIGHLIGHT_NAME, new this.HighlightCtor(...open));
    if (resolved.length === 0) this.registry.delete(HIGHLIGHT_NAME_RESOLVED);
    else this.registry.set(HIGHLIGHT_NAME_RESOLVED, new this.HighlightCtor(...resolved));
    this.repaintEmphasis();
  }

  private repaintEmphasis(): void {
    if (!this.registry || !this.HighlightCtor) return;
    const range = this.emphasisId ? this.ranges.get(this.emphasisId) : undefined;
    if (!range) {
      this.registry.delete(HIGHLIGHT_NAME_EMPHASIS);
      return;
    }
    const highlight = new this.HighlightCtor(range);
    // Paint above the base highlights where the engine honors explicit
    // priority (spec'd on Highlight; best-effort where it isn't read).
    (highlight as { priority?: number }).priority = 1;
    this.registry.set(HIGHLIGHT_NAME_EMPHASIS, highlight);
  }
}

// iframe bridge entry point — bundled by scripts/build-iframe.mjs into an IIFE
// and inlined into every content document by the server. Runs at opaque origin;
// no module imports survive to runtime (esbuild inlines everything).
//
// M4: ready handshake, set-theme, resize reporting.
// M5: text-quote selection capture (with uniqueness expansion), anchor
//     resolve/highlight (CSS Custom Highlight API w/ DOM fallback), activate
//     (click hit-test), clear, and scroll-to.
//
// IMPORTANT: do NOT write the literal string </script> anywhere in this file —
// esbuild escapes it in the output but the source must also be clean for safety.

import { BRIDGE_NAMESPACE, BRIDGE_PROTOCOL_VERSION } from "../protocol.js";
import { fromRange, toRange } from "dom-anchor-text-quote";

// ---------------------------------------------------------------------------
// Wire types (structural — not imported at runtime; core is never bundled)
// ---------------------------------------------------------------------------

interface TextQuote {
  exact: string;
  prefix?: string;
  suffix?: string;
}

interface SelectionCandidate {
  quote: TextQuote;
  smIds: number[];
  xpath?: string;
  css?: string;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

(function () {
  try {
    const NS = BRIDGE_NAMESPACE;
    const V = BRIDGE_PROTOCOL_VERSION;
    const root = document.documentElement;
    const body = document.body;

    // -----------------------------------------------------------------------
    // Messaging helpers
    // -----------------------------------------------------------------------

    function send(msg: object): void {
      try {
        parent.postMessage({ ns: NS, v: V, msg }, "*");
      } catch {
        // cross-origin postMessage can throw in some environments; swallow.
      }
    }

    function isOurEnvelope(
      data: unknown,
    ): data is { ns: string; v: number; msg: Record<string, unknown> } {
      if (typeof data !== "object" || data === null) return false;
      const d = data as Record<string, unknown>;
      return d["ns"] === NS && d["v"] === V && typeof d["msg"] === "object" && d["msg"] !== null;
    }

    // -----------------------------------------------------------------------
    // M4 — Theme
    // -----------------------------------------------------------------------

    const mq = matchMedia("(prefers-color-scheme: dark)");
    let parentControlled = false;

    function applyOs(): void {
      if (!parentControlled) root.classList.toggle("dark", mq.matches);
    }

    applyOs();
    mq.addEventListener("change", applyOs);

    // -----------------------------------------------------------------------
    // M4 — Height reporting
    // -----------------------------------------------------------------------

    let lastH = 0;

    function reportHeight(): void {
      const h = Math.ceil(document.documentElement.scrollHeight);
      if (h !== lastH) {
        lastH = h;
        send({ type: "resize", height: h });
      }
    }

    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(reportHeight).observe(document.documentElement);
    }
    window.addEventListener("load", reportHeight);

    // -----------------------------------------------------------------------
    // M5 — Highlighting infrastructure
    // -----------------------------------------------------------------------

    // Map from anchor id → Range
    const anchorRanges = new Map<string, Range>();

    // CSS Custom Highlight API (Chrome 105+, Safari 17.2+, FF 117+)
    const HIGHLIGHT_NAME = "scholia-anchor";
    const useHighlightAPI =
      typeof CSS !== "undefined" &&
      typeof (CSS as unknown as Record<string, unknown>)["highlights"] !== "undefined" &&
      typeof Highlight !== "undefined";

    // Inject the ::highlight rule once
    if (useHighlightAPI) {
      const style = document.createElement("style");
      // Avoid writing </style> literally — split across concat
      style.textContent =
        "::highlight(scholia-anchor){background-color:rgba(255,213,0,0.45);color:inherit;}";
      (document.head || document.documentElement).appendChild(style);
    }

    // DOM-mutation fallback: wrap matched text in <mark> elements
    const fallbackMarks = new Map<string, Element[]>();

    function rebuildHighlights(): void {
      if (!useHighlightAPI) return;
      const h = new Highlight(...anchorRanges.values());
      (CSS as unknown as { highlights: { set(name: string, h: Highlight): void } }).highlights.set(
        HIGHLIGHT_NAME,
        h,
      );
    }

    function addHighlight(id: string, range: Range): void {
      anchorRanges.set(id, range);
      if (useHighlightAPI) {
        rebuildHighlights();
      } else {
        // Fallback: wrap range in <mark> nodes. This mutates the DOM but is
        // safe for read-only content pages.
        const marks: Element[] = [];
        try {
          const frag = range.cloneContents();
          const mark = document.createElement("mark");
          mark.setAttribute("data-scholia-anchor", id);
          mark.style.backgroundColor = "rgba(255,213,0,0.45)";
          mark.style.color = "inherit";
          mark.appendChild(frag);
          // Replace the range contents with the mark element.
          range.deleteContents();
          range.insertNode(mark);
          marks.push(mark);
        } catch {
          // Range may span elements — best-effort only.
        }
        fallbackMarks.set(id, marks);
      }
    }

    function removeHighlight(id: string): void {
      if (useHighlightAPI) {
        anchorRanges.delete(id);
        rebuildHighlights();
      } else {
        const marks = fallbackMarks.get(id);
        if (marks) {
          for (const mark of marks) {
            const parent = mark.parentNode;
            if (parent) {
              while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
              parent.removeChild(mark);
            }
          }
          fallbackMarks.delete(id);
        }
        anchorRanges.delete(id);
      }
    }

    function clearAllHighlights(): void {
      if (useHighlightAPI) {
        anchorRanges.clear();
        (
          CSS as unknown as {
            highlights: { delete(name: string): void };
          }
        ).highlights.delete(HIGHLIGHT_NAME);
      } else {
        for (const id of anchorRanges.keys()) removeHighlight(id);
      }
    }

    // -----------------------------------------------------------------------
    // M5 — Uniqueness expansion helper
    // -----------------------------------------------------------------------

    // Count exact (case-sensitive, literal) occurrences of `exact` in the body
    // textContent disambiguated by the given prefix/suffix context. We verify
    // uniqueness by attempting to re-resolve via toRange; if it matches nothing
    // or hits an ambiguous result (not directly detectable via the lib — so we
    // use a count-based approach on textContent as a cheaper proxy first).

    const MAX_CONTEXT = 200;

    function countOccurrences(text: string, exact: string): number {
      let count = 0;
      let pos = 0;
      while ((pos = text.indexOf(exact, pos)) !== -1) {
        count++;
        pos += exact.length || 1;
      }
      return count;
    }

    function buildUniqueQuote(
      exact: string,
      bodyText: string,
      selStart: number,
      selEnd: number,
    ): TextQuote {
      // Start with 32-char context (same as library default), then grow.
      let ctxLen = 32;
      while (ctxLen <= MAX_CONTEXT) {
        const prefixStart = Math.max(0, selStart - ctxLen);
        const prefix = bodyText.substring(prefixStart, selStart);
        const suffixEnd = Math.min(bodyText.length, selEnd + ctxLen);
        const suffix = bodyText.substring(selEnd, suffixEnd);

        // Quick check: count occurrences in the body. If <=1 we're unique.
        const occ = countOccurrences(bodyText, exact);
        if (occ <= 1) {
          // Unique by exact text alone — still include context for resilience.
          return { exact, prefix: prefix || undefined, suffix: suffix || undefined };
        }

        // Multiple occurrences: verify prefix+exact+suffix combination is unique.
        const combined = prefix + exact + suffix;
        const combinedOcc = countOccurrences(bodyText, combined);
        if (combinedOcc <= 1) {
          return { exact, prefix: prefix || undefined, suffix: suffix || undefined };
        }

        if (ctxLen >= MAX_CONTEXT) break;
        ctxLen = Math.min(ctxLen * 2, MAX_CONTEXT);
      }

      // Exhausted expansion — return best-effort at MAX_CONTEXT
      const prefixStart = Math.max(0, selStart - MAX_CONTEXT);
      const prefix = bodyText.substring(prefixStart, selStart);
      const suffixEnd = Math.min(bodyText.length, selEnd + MAX_CONTEXT);
      const suffix = bodyText.substring(selEnd, suffixEnd);
      return { exact, prefix: prefix || undefined, suffix: suffix || undefined };
    }

    // -----------------------------------------------------------------------
    // M5 — XPath / CSS selector helpers (best-effort, cheap)
    // -----------------------------------------------------------------------

    function getXPath(el: Element): string {
      const parts: string[] = [];
      let node: Element | null = el;
      while (node && node !== document.documentElement) {
        const parentEl: Element | null = node.parentElement;
        if (!parentEl) break;
        const tag = node.tagName;
        const siblings = Array.from(parentEl.children).filter((c: Element) => c.tagName === tag);
        const idx = siblings.indexOf(node) + 1;
        parts.unshift(siblings.length > 1 ? `${tag.toLowerCase()}[${idx}]` : tag.toLowerCase());
        node = parentEl;
      }
      parts.unshift("html");
      return "/" + parts.join("/");
    }

    function getCssSelector(el: Element): string {
      // Use id if available, else build a tag+nth-child path.
      if (el.id) return `#${CSS.escape(el.id)}`;
      const parts: string[] = [];
      let node: Element | null = el;
      while (node && node !== document.documentElement) {
        const parentEl: Element | null = node.parentElement;
        if (!parentEl) break;
        const tag = node.tagName;
        const siblings = Array.from(parentEl.children).filter((c: Element) => c.tagName === tag);
        const idx = siblings.indexOf(node) + 1;
        const part =
          siblings.length > 1 ? `${tag.toLowerCase()}:nth-of-type(${idx})` : tag.toLowerCase();
        parts.unshift(part);
        node = parentEl;
      }
      return parts.join(" > ");
    }

    // -----------------------------------------------------------------------
    // M5 — Selection capture
    // -----------------------------------------------------------------------

    function captureSelection(): void {
      try {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
          send({ type: "selection-cleared" });
          return;
        }
        const range = sel.getRangeAt(0);
        if (range.collapsed || range.toString().trim() === "") {
          send({ type: "selection-cleared" });
          return;
        }

        // Build text-quote via library (gives us exact + 32-char context to start)
        const libQuote = fromRange(body, range);

        // Uniqueness-expand the quote
        const bodyText = body.textContent ?? "";
        // Determine selection offsets in body textContent for expansion
        const tempRange = document.createRange();
        tempRange.setStart(body, 0);
        tempRange.setEnd(range.startContainer, range.startOffset);
        const selStart = tempRange.toString().length;
        const selEnd = selStart + libQuote.exact.length;

        const quote = buildUniqueQuote(libQuote.exact, bodyText, selStart, selEnd);

        // Collect data-sm ids intersected by the range
        const smIds: number[] = [];
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
        let el: Node | null = walker.nextNode();
        while (el) {
          const elem = el as Element;
          const smVal = elem.getAttribute("data-sm");
          if (smVal !== null && range.intersectsNode(elem)) {
            const n = Number(smVal);
            if (!isNaN(n) && !smIds.includes(n)) smIds.push(n);
          }
          el = walker.nextNode();
        }

        // Best-effort xpath/css of common ancestor element
        let xpath: string | undefined;
        let css: string | undefined;
        try {
          let ancestor = range.commonAncestorContainer;
          if (ancestor.nodeType === Node.TEXT_NODE) ancestor = ancestor.parentElement!;
          if (ancestor && ancestor instanceof Element && ancestor !== body) {
            xpath = getXPath(ancestor);
            css = getCssSelector(ancestor);
          }
        } catch {
          // best-effort
        }

        const rect = range.getBoundingClientRect();
        const candidate: SelectionCandidate = {
          quote,
          smIds,
          ...(xpath ? { xpath } : {}),
          ...(css ? { css } : {}),
        };

        send({
          type: "selection",
          candidate,
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            left: rect.left,
          },
        });
      } catch {
        // swallow — we never crash the page
      }
    }

    let selectionTimer: ReturnType<typeof setTimeout> | null = null;

    function scheduleCapture(): void {
      if (selectionTimer !== null) clearTimeout(selectionTimer);
      // Small debounce so mouseup+selectionchange don't double-fire
      selectionTimer = setTimeout(captureSelection, 30);
    }

    document.addEventListener("selectionchange", scheduleCapture);
    document.addEventListener("mouseup", scheduleCapture);

    // -----------------------------------------------------------------------
    // M5 — Click hit-test for anchor-activated
    // -----------------------------------------------------------------------

    document.addEventListener("click", function (e: MouseEvent) {
      try {
        const cx = e.clientX,
          cy = e.clientY;
        for (const [id, range] of anchorRanges) {
          const rects = range.getClientRects();
          for (let i = 0; i < rects.length; i++) {
            const r = rects[i]!;
            if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
              send({ type: "anchor-activated", id });
              break;
            }
          }
        }
      } catch {
        // swallow
      }
    });

    // -----------------------------------------------------------------------
    // Inbound message handler
    // -----------------------------------------------------------------------

    window.addEventListener("message", function (e: MessageEvent) {
      if (!isOurEnvelope(e.data)) return;
      const m = e.data.msg;

      switch (m["type"]) {
        case "set-theme":
          parentControlled = true;
          root.classList.toggle("dark", m["theme"] === "dark");
          break;

        case "resolve-anchor": {
          const id = m["id"] as string;
          const quote = m["quote"] as TextQuote;
          try {
            const range = toRange(body, quote);
            if (range) {
              // Remove any existing highlight for this id before re-adding
              removeHighlight(id);
              addHighlight(id, range);
              const rect = range.getBoundingClientRect();
              send({
                type: "anchor-resolved",
                id,
                found: true,
                rect: {
                  x: rect.x,
                  y: rect.y,
                  width: rect.width,
                  height: rect.height,
                  top: rect.top,
                  right: rect.right,
                  bottom: rect.bottom,
                  left: rect.left,
                },
              });
            } else {
              send({ type: "anchor-resolved", id, found: false });
            }
          } catch {
            send({ type: "anchor-resolved", id, found: false });
          }
          break;
        }

        case "clear-anchors":
          clearAllHighlights();
          break;

        case "scroll-to": {
          const id = m["id"] as string;
          const range = anchorRanges.get(id);
          if (range) {
            try {
              // Create a temporary zero-size element at range start and scroll to it.
              const el = document.createElement("span");
              range.insertNode(el);
              el.scrollIntoView({ block: "center", behavior: "smooth" });
              el.parentNode?.removeChild(el);
            } catch {
              try {
                const container = range.startContainer;
                const target =
                  container.nodeType === Node.TEXT_NODE
                    ? container.parentElement
                    : (container as Element);
                if (target instanceof Element) {
                  target.scrollIntoView({ block: "center", behavior: "smooth" });
                }
              } catch {
                // best-effort
              }
            }
          }
          break;
        }
      }
    });

    // -----------------------------------------------------------------------
    // M4 — Handshake (last, after all listeners are wired)
    // -----------------------------------------------------------------------

    send({ type: "ready" });
    reportHeight();
  } catch {
    // Outer try/catch ensures we never crash the hosted page.
  }
})();

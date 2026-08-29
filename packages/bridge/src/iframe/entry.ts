// iframe bridge entry point — bundled by scripts/build-iframe.mjs into an IIFE
// and inlined into every content document by the server. Runs at opaque origin;
// no module imports survive to runtime (esbuild inlines everything).
//
// M4: ready handshake, set-theme, resize reporting.
// M5: text-quote selection capture (with uniqueness expansion), anchor
//     resolve/highlight (CSS Custom Highlight API w/ DOM fallback), activate
//     (click hit-test), clear, and scroll-to.
//
// The anchoring itself is not implemented here: capture and highlighting live in
// ../dom, shared with the in-document consumer (Local Preview) so one rule
// decides what an Anchor is on both paths. What is left here is the postMessage
// half — the part that is genuinely specific to being framed.
//
// IMPORTANT: do NOT write the literal string </script> anywhere in this file —
// esbuild escapes it in the output but the source must also be clean for safety.

import { BRIDGE_NAMESPACE, BRIDGE_PROTOCOL_VERSION } from "../protocol.js";
import { captureSelection } from "../dom/selection.js";
import { AnchorHighlights } from "../dom/highlight.js";
import type { TextQuote } from "../dom/quote.js";

// Serialize a range's bounding box for the wire — a DOMRect is not
// structured-cloneable, and the parent only ever reads these fields.
function rectOf(range: Range): Record<string, number> {
  const r = range.getBoundingClientRect();
  return {
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    top: r.top,
    right: r.right,
    bottom: r.bottom,
    left: r.left,
  };
}

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
    // M5 — Anchors
    // -----------------------------------------------------------------------

    const highlights = new AnchorHighlights(body);

    // -----------------------------------------------------------------------
    // M5 — Selection capture
    // -----------------------------------------------------------------------

    function reportSelection(): void {
      try {
        const captured = captureSelection(body, window.getSelection());
        if (!captured) {
          send({ type: "selection-cleared" });
          return;
        }
        send({ type: "selection", candidate: captured.candidate, rect: rectOf(captured.range) });
      } catch {
        // swallow — we never crash the page
      }
    }

    let selectionTimer: ReturnType<typeof setTimeout> | null = null;

    function scheduleCapture(): void {
      if (selectionTimer !== null) clearTimeout(selectionTimer);
      // Small debounce so mouseup+selectionchange don't double-fire
      selectionTimer = setTimeout(reportSelection, 30);
    }

    document.addEventListener("selectionchange", scheduleCapture);
    document.addEventListener("mouseup", scheduleCapture);

    // -----------------------------------------------------------------------
    // M5 — Click hit-test for anchor-activated
    // -----------------------------------------------------------------------

    document.addEventListener("click", function (e: MouseEvent) {
      try {
        // Always reported, not only on a hit: a click that misses every
        // highlight is the parent's cue to clear a stale active card
        // (issue #109), so `id` is null rather than the message being skipped.
        const id = highlights.hitTest(e.clientX, e.clientY);
        send({ type: "anchor-activated", id });
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
        // The parent started listening after our one-shot `ready` — announce again
        // so it can flush whatever it queued meanwhile. Idempotent on both sides.
        case "ping":
          send({ type: "ready" });
          reportHeight();
          break;

        case "set-theme":
          parentControlled = true;
          root.classList.toggle("dark", m["theme"] === "dark");
          break;

        case "resolve-anchor": {
          const id = m["id"] as string;
          const range = highlights.resolve(id, m["quote"] as TextQuote, m["resolved"] === true);
          if (range) send({ type: "anchor-resolved", id, found: true, rect: rectOf(range) });
          else send({ type: "anchor-resolved", id, found: false });
          break;
        }

        case "clear-anchors":
          highlights.clear();
          break;

        case "scroll-to":
          highlights.scrollTo(m["id"] as string);
          break;

        case "emphasize-anchor":
          highlights.emphasize(m["id"] as string | null);
          break;
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

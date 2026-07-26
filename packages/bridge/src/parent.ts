import {
  envelope,
  isEnvelope,
  type ParentMessage,
  type Theme,
} from "./protocol.js";
import type { TextQuote, SelectionCandidate } from "@scholia/core";

// Parent-side (viewer chrome) end of the bridge. Attaches to a content iframe,
// completes the handshake, pushes the chrome's theme, surfaces content height,
// and (M5) drives the anchoring channel: it forwards selections the iframe
// captures and asks the iframe to resolve/highlight stored anchors. Used by
// `@scholia/web` (ADR-0003, PLAN §5 M4/M5). DOM-only; no framework dependency.

// Emitted when the user makes a non-empty selection in the content. `rect` is in
// the iframe's own coordinate space — the caller offsets it by the iframe's
// position to place chrome-side affordances.
export interface SelectionEvent {
  candidate: SelectionCandidate;
  rect: DOMRectInit;
}

// Result of a resolveAnchor() call.
export interface AnchorResolvedEvent {
  id: string;
  found: boolean;
  /** Bounding rect of the matched range (iframe coordinates), if found. */
  rect?: DOMRectInit;
}

export interface ConnectOptions {
  /** Theme to push once the iframe reports `ready`. */
  theme?: Theme;
  /** Called when the iframe completes its handshake. */
  onReady?: () => void;
  /** Called whenever the content reports a new height (px). */
  onResize?: (height: number) => void;
  /** Called when the user makes a non-empty text selection in the content. */
  onSelection?: (event: SelectionEvent) => void;
  /** Called when the selection is cleared / collapsed. */
  onSelectionCleared?: () => void;
  /** Called when an anchor resolve attempt completes. */
  onAnchorResolved?: (event: AnchorResolvedEvent) => void;
  /** Called when the user clicks an existing anchor highlight. */
  onAnchorActivated?: (id: string) => void;
}

export interface BridgeHandle {
  /** Push a new theme to the content document. */
  setTheme(theme: Theme): void;
  /** Resolve a stored anchor's text-quote against the DOM and highlight it. */
  resolveAnchor(id: string, quote: TextQuote): void;
  /** Remove all anchor highlights in the content (e.g. before re-resolving). */
  clearAnchors(): void;
  /** Scroll a previously-resolved anchor highlight into view. */
  scrollToAnchor(id: string): void;
  /** Detach the message listener. */
  dispose(): void;
}

export function connectBridge(
  iframe: HTMLIFrameElement,
  options: ConnectOptions = {},
): BridgeHandle {
  let theme = options.theme;
  let ready = false;
  // Resolve/scroll requests issued before the handshake are queued and flushed
  // once the iframe is `ready`.
  const pending: ParentMessage[] = [];

  function post(msg: ParentMessage): void {
    if (!ready && msg.type !== "set-theme") {
      pending.push(msg);
      return;
    }
    iframe.contentWindow?.postMessage(envelope(msg), "*");
  }

  function onMessage(event: MessageEvent): void {
    // Only trust messages from this iframe's content window.
    if (event.source !== iframe.contentWindow) return;
    if (!isEnvelope(event.data)) return;
    const msg = event.data.msg;
    switch (msg.type) {
      case "ready":
        ready = true;
        if (theme) post({ type: "set-theme", theme });
        for (const queued of pending.splice(0)) {
          iframe.contentWindow?.postMessage(envelope(queued), "*");
        }
        options.onReady?.();
        break;
      case "resize":
        options.onResize?.(msg.height);
        break;
      case "selection":
        options.onSelection?.({ candidate: msg.candidate, rect: msg.rect });
        break;
      case "selection-cleared":
        options.onSelectionCleared?.();
        break;
      case "anchor-resolved":
        options.onAnchorResolved?.({ id: msg.id, found: msg.found, rect: msg.rect });
        break;
      case "anchor-activated":
        options.onAnchorActivated?.(msg.id);
        break;
      // `set-theme` / `resolve-anchor` / `clear-anchors` / `scroll-to` are
      // parent->iframe only; ignore if echoed back.
    }
  }

  window.addEventListener("message", onMessage);

  return {
    setTheme(next: Theme) {
      theme = next;
      if (ready) post({ type: "set-theme", theme: next });
    },
    resolveAnchor(id: string, quote: TextQuote) {
      post({ type: "resolve-anchor", id, quote });
    },
    clearAnchors() {
      post({ type: "clear-anchors" });
    },
    scrollToAnchor(id: string) {
      post({ type: "scroll-to", id });
    },
    dispose() {
      window.removeEventListener("message", onMessage);
    },
  };
}

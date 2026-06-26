import {
  envelope,
  isEnvelope,
  type ParentMessage,
  type Theme,
} from "./protocol.js";

// Parent-side (viewer chrome) end of the bridge. Attaches to a content iframe,
// completes the handshake, pushes the chrome's theme, and surfaces content
// height. Used by `@collab/web` (ADR-0003, PLAN §5 M4). DOM-only; no framework
// dependency, so it can be reused outside Preact.

export interface ConnectOptions {
  /** Theme to push once the iframe reports `ready`. */
  theme?: Theme;
  /** Called when the iframe completes its handshake. */
  onReady?: () => void;
  /** Called whenever the content reports a new height (px). */
  onResize?: (height: number) => void;
}

export interface BridgeHandle {
  /** Push a new theme to the content document. */
  setTheme(theme: Theme): void;
  /** Detach the message listener. */
  dispose(): void;
}

export function connectBridge(
  iframe: HTMLIFrameElement,
  options: ConnectOptions = {},
): BridgeHandle {
  let theme = options.theme;
  let ready = false;

  function post(msg: ParentMessage): void {
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
        options.onReady?.();
        break;
      case "resize":
        options.onResize?.(msg.height);
        break;
      // `set-theme` is parent->iframe only; ignore if echoed back.
    }
  }

  window.addEventListener("message", onMessage);

  return {
    setTheme(next: Theme) {
      theme = next;
      if (ready) post({ type: "set-theme", theme: next });
    },
    dispose() {
      window.removeEventListener("message", onMessage);
    },
  };
}

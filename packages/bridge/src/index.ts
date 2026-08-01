// @scholia/bridge — the versioned parent <-> iframe postMessage protocol and its
// two ends: a string-emitted script inlined into the sandboxed content document
// (server) and a DOM client for the viewer chrome (web). ADR-0003, PLAN §5 M4.
//
// It also owns the DOM half of anchoring (./dom) — capturing a selection as a
// unique text-quote and resolving stored quotes back into the rendered DOM.
// That lives here rather than in either delivery package because both surfaces
// that host Page content need it: the sandboxed iframe reaches it through the
// protocol above, and Local Preview, whose content is in the chrome document,
// calls it directly (ADR-0029 "anchors resolve against rendered text", ADR-0030).

export {
  BRIDGE_NAMESPACE,
  BRIDGE_PROTOCOL_VERSION,
  envelope,
  isEnvelope,
  type Theme,
  type BridgeMessage,
  type IframeMessage,
  type ParentMessage,
  type Envelope,
} from "./protocol.js";

export { iframeBridgeScript } from "./inline.js";

export {
  connectBridge,
  type ConnectOptions,
  type BridgeHandle,
  type SelectionEvent,
  type AnchorResolvedEvent,
} from "./parent.js";

// The DOM half of anchoring, for a consumer whose content is in its own document.
export {
  captureSelection,
  type CapturedSelection,
  type SelectionCandidate,
} from "./dom/selection.js";
export { AnchorHighlights } from "./dom/highlight.js";
export type { TextQuote } from "./dom/quote.js";

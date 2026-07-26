// @scholia/bridge — the versioned parent <-> iframe postMessage protocol and its
// two ends: a string-emitted script inlined into the sandboxed content document
// (server) and a DOM client for the viewer chrome (web). ADR-0003, PLAN §5 M4.

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

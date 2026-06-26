// The versioned parent <-> iframe postMessage protocol (ADR-0003, PLAN §5 M4).
// The Collab chrome (viewer) is the parent document; Page content runs in a
// sandboxed cross-origin iframe. Because the iframe is an opaque origin, every
// message is wrapped in a namespaced, versioned envelope so each side can
// reject foreign or version-skewed messages — and so the M5 selection/anchor
// messages can be added without breaking M4 clients.
//
// M4 scope: handshake (`ready`), parent-driven theme (`set-theme`), and
// content height (`resize`). Selection capture and anchor resolution are
// reserved for M5 — their message types are sketched below but not implemented.

export const BRIDGE_NAMESPACE = "collab-bridge" as const;
export const BRIDGE_PROTOCOL_VERSION = 1 as const;

export type Theme = "light" | "dark";

// Messages the iframe (content) sends up to the parent (viewer chrome).
export type IframeMessage =
  // Handshake: content document loaded and the bridge is listening.
  | { type: "ready" }
  // Content height changed; lets the parent size the iframe to its content.
  | { type: "resize"; height: number };
// Reserved for M5 (kept here so the protocol version is stable across the
// M4/M5 boundary):
//   | { type: "selection"; quote: TextQuote; sourceRange?: [number, number]; rect: DOMRectInit }
//   | { type: "anchor-resolved"; id: string; found: boolean }

// Messages the parent sends down to the iframe.
export type ParentMessage =
  // Apply the chrome's current color scheme inside the content document.
  | { type: "set-theme"; theme: Theme };
// Reserved for M5:
//   | { type: "resolve-anchor"; id: string; anchor: Anchor }
//   | { type: "scroll-to"; id: string }

export type BridgeMessage = IframeMessage | ParentMessage;

export interface Envelope<M extends BridgeMessage = BridgeMessage> {
  ns: typeof BRIDGE_NAMESPACE;
  v: typeof BRIDGE_PROTOCOL_VERSION;
  msg: M;
}

export function envelope<M extends BridgeMessage>(msg: M): Envelope<M> {
  return { ns: BRIDGE_NAMESPACE, v: BRIDGE_PROTOCOL_VERSION, msg };
}

// Accept only same-namespace, same-version envelopes. Cross-version messages
// are ignored (forward-compatible: a newer peer's unknown messages are dropped
// rather than mishandled).
export function isEnvelope(data: unknown): data is Envelope {
  if (typeof data !== "object" || data === null) return false;
  const e = data as Record<string, unknown>;
  return (
    e.ns === BRIDGE_NAMESPACE &&
    e.v === BRIDGE_PROTOCOL_VERSION &&
    typeof e.msg === "object" &&
    e.msg !== null &&
    typeof (e.msg as Record<string, unknown>).type === "string"
  );
}

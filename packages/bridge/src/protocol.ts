// The versioned parent <-> iframe postMessage protocol (ADR-0003, PLAN §5 M4/M5).
// The Scholia chrome (viewer) is the parent document; Page content runs in a
// sandboxed cross-origin iframe. Because the iframe is an opaque origin, every
// message is wrapped in a namespaced, versioned envelope so each side can
// reject foreign or version-skewed messages.
//
// M4 scope: handshake (`ready`), parent-driven theme (`set-theme`), and content
// height (`resize`). M5 adds the anchoring channel: the iframe reports text
// selections (`selection`/`selection-cleared`) and the result of resolving an
// anchor into the DOM (`anchor-resolved`) or the user activating a highlight
// (`anchor-activated`); the parent asks the iframe to resolve+highlight anchors
// (`resolve-anchor`), clear them (`clear-anchors`), or scroll one into view
// (`scroll-to`). The protocol version stays 1 — adding message variants is
// forward-compatible (unknown variants are dropped by `isEnvelope` consumers).
//
// Anchoring wire types (`TextQuote`, `SelectionCandidate`) are imported as
// TYPE-ONLY from @scholia/core so they are erased before the iframe bundle is
// built (esbuild never pulls core's runtime into the inlined content script).
import type { TextQuote, SelectionCandidate } from "@scholia/core";

export const BRIDGE_NAMESPACE = "scholia-bridge" as const;
export const BRIDGE_PROTOCOL_VERSION = 1 as const;

export type Theme = "light" | "dark";

// Messages the iframe (content) sends up to the parent (viewer chrome).
export type IframeMessage =
  // Handshake: content document loaded and the bridge is listening.
  | { type: "ready" }
  // Content height changed; lets the parent size the iframe to its content.
  | { type: "resize"; height: number }
  // A non-empty text selection was made; carries the captured, uniquely-expanded
  // anchor candidate and the selection's bounding rect (in iframe coordinates)
  // so the parent can position the "comment" affordance.
  | { type: "selection"; candidate: SelectionCandidate; rect: DOMRectInit }
  // The selection was cleared / collapsed.
  | { type: "selection-cleared" }
  // Result of a `resolve-anchor` request: whether the quote matched and, if so,
  // the matched range's bounding rect (iframe coordinates) for marker placement.
  | { type: "anchor-resolved"; id: string; found: boolean; rect?: DOMRectInit }
  // The user clicked an existing anchor highlight.
  | { type: "anchor-activated"; id: string };

// Messages the parent sends down to the iframe.
export type ParentMessage =
  // Apply the chrome's current color scheme inside the content document.
  | { type: "set-theme"; theme: Theme }
  // "Are you already there?" — answered with `ready`. The iframe announces `ready`
  // once, when its script runs, so a parent that starts listening *after* that
  // (the chrome is server-rendered, so the iframe can begin loading before the
  // chrome hydrates) would otherwise never learn it, and would queue every
  // resolve-anchor request forever. Sent unqueued on connect; harmless if the
  // content isn't up yet, because then its own `ready` still arrives.
  | { type: "ping" }
  // Resolve a stored anchor's text-quote against the DOM and highlight it.
  | { type: "resolve-anchor"; id: string; quote: TextQuote }
  // Remove all anchor highlights (e.g. on page navigation).
  | { type: "clear-anchors" }
  // Scroll a previously-resolved anchor highlight into view.
  | { type: "scroll-to"; id: string };

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

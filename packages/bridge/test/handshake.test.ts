import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { connectBridge } from "../src/parent.js";
import { BRIDGE_NAMESPACE, BRIDGE_PROTOCOL_VERSION, type ParentMessage } from "../src/protocol.js";

// The handshake is one-shot in one direction: the content announces `ready` when its
// script runs, and if the parent isn't listening yet that announcement is gone. The
// viewer's chrome is server-rendered, so the iframe can start loading before the
// chrome hydrates — which makes "parent connects late" a normal case, not an edge
// one. These tests pin both orderings.

/** A stand-in for the sandboxed content window: records what the parent posts. */
class FakeContentWindow {
  posted: ParentMessage[] = [];
  postMessage(data: unknown) {
    const e = data as { ns: string; v: number; msg: ParentMessage };
    if (e.ns === BRIDGE_NAMESPACE && e.v === BRIDGE_PROTOCOL_VERSION) this.posted.push(e.msg);
  }
  types() {
    return this.posted.map((m) => m.type);
  }
}

let listeners: ((e: MessageEvent) => void)[];
let content: FakeContentWindow;
let iframe: HTMLIFrameElement;

beforeEach(() => {
  listeners = [];
  content = new FakeContentWindow();
  iframe = { contentWindow: content } as unknown as HTMLIFrameElement;
  // A minimal `window` for the parent module: it only listens for "message".
  globalThis.window = {
    addEventListener: (type: string, fn: (e: MessageEvent) => void) => {
      if (type === "message") listeners.push(fn);
    },
    removeEventListener: (_type: string, fn: (e: MessageEvent) => void) => {
      listeners = listeners.filter((l) => l !== fn);
    },
  } as unknown as Window & typeof globalThis;
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

/** Deliver a message from the content window to the parent. */
function fromContent(msg: unknown) {
  const event = {
    source: content,
    data: { ns: BRIDGE_NAMESPACE, v: BRIDGE_PROTOCOL_VERSION, msg },
  };
  for (const l of listeners) l(event as unknown as MessageEvent);
}

const QUOTE = { exact: "a passage" };

describe("connectBridge handshake", () => {
  test("pings on connect, in case the content is already loaded", () => {
    connectBridge(iframe, { theme: "light" });

    expect(content.types()).toEqual(["ping"]);
  });

  test("queues anchor work until the content says it is ready", () => {
    const bridge = connectBridge(iframe);
    bridge.resolveAnchor("a1", QUOTE, false);

    expect(content.types()).toEqual(["ping"]);

    fromContent({ type: "ready" });

    expect(content.types()).toEqual(["ping", "resolve-anchor"]);
  });

  // The regression this exists for: without the ping, a parent that attached its
  // listener after the content's one-shot `ready` never flushed, so no Anchor was
  // ever highlighted.
  test("flushes when the content answers a ping, its own ready having been missed", () => {
    const bridge = connectBridge(iframe, { theme: "dark" });
    bridge.resolveAnchor("a1", QUOTE, false);
    bridge.scrollToAnchor("a1");

    // The content was already up: it never sees the parent's listener appear, and
    // only replies because it was asked.
    expect(content.types()).toEqual(["ping"]);
    fromContent({ type: "ready" });

    expect(content.types()).toEqual(["ping", "set-theme", "resolve-anchor", "scroll-to"]);
  });

  test("carries the latest theme through the handshake rather than queueing it", () => {
    const bridge = connectBridge(iframe);
    bridge.setTheme("dark");

    // A theme set before the handshake is remembered, not queued — there is no point
    // replaying a value that a later call may have superseded.
    expect(content.types()).toEqual(["ping"]);

    // The handshake pushes whatever the theme is by then, so the content is never
    // left on the wrong one.
    fromContent({ type: "ready" });
    expect(content.posted.at(-1)).toEqual({ type: "set-theme", theme: "dark" });

    bridge.setTheme("light");
    expect(content.posted.at(-1)).toEqual({ type: "set-theme", theme: "light" });
  });

  test("ignores messages that aren't from this iframe's content window", () => {
    const bridge = connectBridge(iframe);
    bridge.resolveAnchor("a1", QUOTE, false);

    const foreign = {
      source: new FakeContentWindow(),
      data: { ns: BRIDGE_NAMESPACE, v: BRIDGE_PROTOCOL_VERSION, msg: { type: "ready" } },
    };
    for (const l of listeners) l(foreign as unknown as MessageEvent);

    // Still queued: a foreign "ready" must not complete our handshake.
    expect(content.types()).toEqual(["ping"]);
  });

  // issue #109: which base highlight a passage joins (full-strength vs dimmed)
  // is the owning Conversation's resolved state, carried on the wire rather
  // than decided client-side.
  test("carries the Conversation's resolved state on resolve-anchor", () => {
    const bridge = connectBridge(iframe);
    bridge.resolveAnchor("a1", QUOTE, true);
    fromContent({ type: "ready" });

    expect(content.posted.at(-1)).toEqual({
      type: "resolve-anchor",
      id: "a1",
      quote: QUOTE,
      resolved: true,
    });
  });

  test("emphasizeAnchor posts the hovered id, and null to clear it", () => {
    const bridge = connectBridge(iframe);
    fromContent({ type: "ready" });

    bridge.emphasizeAnchor("a1");
    expect(content.posted.at(-1)).toEqual({ type: "emphasize-anchor", id: "a1" });

    bridge.emphasizeAnchor(null);
    expect(content.posted.at(-1)).toEqual({ type: "emphasize-anchor", id: null });
  });

  // A click that hits nothing is reported too (id: null), not skipped — the
  // parent's cue to clear a stale active card (issue #109).
  test("onAnchorActivated is called with null when a click misses every highlight", () => {
    const seen: (string | null)[] = [];
    connectBridge(iframe, { onAnchorActivated: (id) => seen.push(id) });
    fromContent({ type: "ready" });

    fromContent({ type: "anchor-activated", id: "a1" });
    fromContent({ type: "anchor-activated", id: null });

    expect(seen).toEqual(["a1", null]);
  });
});

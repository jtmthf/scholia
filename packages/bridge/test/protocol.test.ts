import { describe, test, expect } from "vitest";
import {
  BRIDGE_NAMESPACE,
  BRIDGE_PROTOCOL_VERSION,
  envelope,
  isEnvelope,
} from "../src/protocol.js";
import { iframeBridgeScript } from "../src/inline.js";

describe("bridge envelope (M4)", () => {
  test("wraps a message with the namespace + version", () => {
    const e = envelope({ type: "ready" });
    expect(e).toEqual({
      ns: BRIDGE_NAMESPACE,
      v: BRIDGE_PROTOCOL_VERSION,
      msg: { type: "ready" },
    });
  });

  test("isEnvelope accepts only same-namespace, same-version envelopes", () => {
    expect(isEnvelope(envelope({ type: "resize", height: 42 }))).toBe(true);
    expect(isEnvelope({ ns: "other", v: 1, msg: { type: "ready" } })).toBe(false);
    expect(isEnvelope({ ns: BRIDGE_NAMESPACE, v: 999, msg: { type: "ready" } })).toBe(false);
    expect(isEnvelope({ ns: BRIDGE_NAMESPACE, v: 1, msg: {} })).toBe(false);
    expect(isEnvelope(null)).toBe(false);
    expect(isEnvelope("nope")).toBe(false);
  });
});

describe("iframeBridgeScript (bundled iframe script)", () => {
  // Now an esbuild-minified IIFE (M5): the protocol constants are inlined as
  // literals rather than `var NS=...`/`V=...`, so assert on the surviving
  // string literals (the namespace + the message `type` values), not on source
  // syntax. Behavior is exercised end-to-end by the Playwright smoke test.
  const script = iframeBridgeScript();

  test("is a non-empty self-contained script carrying the protocol namespace", () => {
    expect(script.length).toBeGreaterThan(0);
    // The namespace string is inlined into the postMessage envelopes.
    expect(script).toContain(BRIDGE_NAMESPACE);
  });

  test("wires the M4 handshake/theme/height and the M5 anchoring messages", () => {
    expect(script).toContain("ready");
    expect(script).toContain("set-theme");
    expect(script).toContain("resize");
    // M5: selection capture + anchor resolution.
    expect(script).toContain("selection");
    expect(script).toContain("anchor-resolved");
    expect(script).toContain("resolve-anchor");
  });

  test("contains no </script> sequence that would break inlining", () => {
    expect(script.toLowerCase()).not.toContain("</script");
  });
});

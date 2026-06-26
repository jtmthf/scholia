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

describe("iframeBridgeScript (M4)", () => {
  const script = iframeBridgeScript();

  test("is self-contained and carries the protocol namespace + version", () => {
    expect(script).toContain(JSON.stringify(BRIDGE_NAMESPACE));
    expect(script).toContain(`V=${BRIDGE_PROTOCOL_VERSION}`);
  });

  test("performs the handshake and handles theme + height", () => {
    expect(script).toContain(`{type:"ready"}`);
    expect(script).toContain(`set-theme`);
    expect(script).toContain(`type:"resize"`);
  });

  test("contains no </script> sequence that would break inlining", () => {
    expect(script.toLowerCase()).not.toContain("</script");
  });
});

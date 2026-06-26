import { describe, test, expect } from "vitest";
import { iframeBridgeScript } from "../src/inline.js";
import { BRIDGE_NAMESPACE } from "../src/protocol.js";

describe("iframeBridgeScript (M5)", () => {
  const script = iframeBridgeScript();

  test("returns a non-empty string", () => {
    expect(typeof script).toBe("string");
    expect(script.length).toBeGreaterThan(0);
  });

  test("contains the bridge namespace", () => {
    expect(script).toContain(BRIDGE_NAMESPACE);
  });

  test("does not contain </script> sequence", () => {
    expect(script.toLowerCase()).not.toContain("</script");
  });

  test("does not bundle core deps (shiki, unified)", () => {
    expect(script).not.toContain("shiki");
    expect(script).not.toContain("unified");
  });

  test("contains M4 handshake types", () => {
    expect(script).toContain("ready");
    expect(script).toContain("resize");
    expect(script).toContain("set-theme");
  });

  test("contains M5 anchoring types", () => {
    expect(script).toContain("selection");
    expect(script).toContain("anchor-resolved");
    expect(script).toContain("resolve-anchor");
    expect(script).toContain("clear-anchors");
    expect(script).toContain("scroll-to");
    expect(script).toContain("anchor-activated");
  });
});

import { describe, test, expect } from "vitest";
import { sourceRangeToLines } from "../src/mirror/line-map.js";
import { botBody, botFileLevelBody } from "../src/mirror/github-provider.js";

describe("sourceRangeToLines", () => {
  const MD = "# Title\n\nSome **bold** text.\n\nA second paragraph.\n";

  test("offset 0 → line 1", () => {
    const r = sourceRangeToLines(MD, { start: 0, end: 5 });
    expect(r.startLine).toBe(1);
    expect(r.endLine).toBe(1);
    expect(r.side).toBe("RIGHT");
  });

  test("offset spanning a newline → correct line", () => {
    // "# Title\n" = 9 chars (0–8), then "\n" at index 9, then "\nSome..."
    // offset 10 is the blank line → line 3
    const r = sourceRangeToLines(MD, { start: 10, end: 15 });
    expect(r.startLine).toBe(3);
  });

  test("multi-line selection → endLine is the closing line", () => {
    // "Some **bold** text." starts at offset 11 (line 3)
    // "A second paragraph." starts at offset 33 (line 5)
    const r = sourceRangeToLines(MD, { start: 11, end: 52 });
    expect(r.startLine).toBe(3);
    expect(r.endLine).toBe(5);
  });

  test("empty source → line 1", () => {
    const r = sourceRangeToLines("", { start: 0, end: 0 });
    expect(r.startLine).toBe(1);
    expect(r.endLine).toBe(1);
  });

  test("offset beyond length clamps", () => {
    const r = sourceRangeToLines("short", { start: 0, end: 100 });
    expect(r.endLine).toBe(1);
  });

  test("Uint8Array input works same as string", () => {
    const bytes = new TextEncoder().encode(MD);
    const r = sourceRangeToLines(bytes, { start: 11, end: 27 });
    expect(r.startLine).toBe(3);
    expect(r.endLine).toBe(3);
  });
});

describe("botBody", () => {
  test("human author — name + (via Scholia)", () => {
    const body = botBody({ name: "Jane", kind: "human" }, "Looks good.");
    expect(body).toBe("**Jane** (via Scholia)\n\nLooks good.");
  });

  test("agent author — name + on behalf of", () => {
    const body = botBody(
      { name: "Jane's agent", kind: "agent", onBehalfOf: "Jane" },
      "Found a bug.",
    );
    expect(body).toBe("**Jane's agent (on behalf of Jane)** (via Scholia)\n\nFound a bug.");
  });

  test("agent author without onBehalfOf", () => {
    const body = botBody({ name: "Bot", kind: "agent" }, "Hello.");
    expect(body).toBe("**Bot** (via Scholia)\n\nHello.");
  });
});

describe("botFileLevelBody", () => {
  test("includes quoted anchor text", () => {
    const body = botFileLevelBody({ name: "Jane", kind: "human" }, "See this issue.", {
      textQuote: { exact: "Some bold text" },
    });
    expect(body).toContain("**Jane** (via Scholia)");
    expect(body).toContain("See this issue.");
    expect(body).toContain("> Some bold text");
  });

  test("no anchor → just the bot body", () => {
    const body = botFileLevelBody({ name: "Jane", kind: "human" }, "No anchor.", null);
    expect(body).toBe("**Jane** (via Scholia)\n\nNo anchor.");
    expect(body).not.toContain(">");
  });
});

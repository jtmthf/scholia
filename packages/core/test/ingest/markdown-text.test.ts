import { describe, test, expect } from "vitest";
import { markdownText } from "../../src/ingest/markdown-text.js";

describe("markdownText", () => {
  test("drops heading markers and keeps the heading's words", () => {
    expect(markdownText("# Anchor\n\nProse follows.")).toBe("Anchor\n\nProse follows.");
  });

  test("drops emphasis markers", () => {
    expect(markdownText("**Throwaway.** A _quick_ note.")).toBe("Throwaway. A quick note.");
  });

  test("keeps a link's text and drops its target", () => {
    expect(markdownText("See [ADR-0002](./0002-text-quote.md) for why.")).toBe(
      "See ADR-0002 for why.",
    );
  });

  test("keeps inline code's contents without its backticks", () => {
    expect(markdownText("Call `renderedText()` first.")).toBe("Call renderedText() first.");
  });

  test("keeps a fenced block's code and drops the fence", () => {
    expect(markdownText("```ts\nconst x = 1;\n```")).toBe("const x = 1;");
  });

  test("keeps list items' text and drops the bullets", () => {
    expect(markdownText("- one\n- two\n")).toBe("one\n\ntwo");
  });

  test("uses an image's alt text", () => {
    expect(markdownText("![A diagram](./d.png)")).toBe("A diagram");
  });

  test("takes the visible text out of inline and block HTML", () => {
    expect(markdownText("<div>Raw <b>html</b></div>\n")).toBe("Raw html");
    expect(markdownText("A <kbd>key</kbd> press.")).toBe("A key press.");
  });

  test("keeps a raw HTML block's items apart rather than running them together", () => {
    // The difference between the derived-text extractor and the anchor-matching
    // one: the latter concatenates text nodes with nothing between them, so
    // these two items would index as the single word "onetwo".
    expect(markdownText("<ul><li>one</li><li>two</li></ul>\n")).toBe("one\ntwo");
  });

  test("keeps a table's cells", () => {
    const table = "| Package | Role |\n| --- | --- |\n| `core` | Domain logic |\n";
    expect(markdownText(table)).toContain("Domain logic");
    expect(markdownText(table)).not.toContain("---");
  });

  test("drops a blockquote's marker", () => {
    expect(markdownText("> Quoted line")).toBe("Quoted line");
  });

  test("returns an empty string for empty input", () => {
    expect(markdownText("")).toBe("");
  });
});

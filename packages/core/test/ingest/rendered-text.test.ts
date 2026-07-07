import { describe, test, expect } from "vitest";
import { renderedText } from "../../src/ingest/rendered-text.js";

describe("renderedText", () => {
  test("concatenates text nodes across elements in document order", () => {
    const html = `<h1>Title</h1><p>Hello <strong>bold</strong> world</p>`;
    expect(renderedText(html)).toBe("TitleHello bold world");
  });

  test("does not collapse whitespace (matches DOM textContent)", () => {
    const html = `<p>a   b\n\tc</p>`;
    expect(renderedText(html)).toBe("a   b\n\tc");
  });

  test("skips <script> and <style> text", () => {
    const html = `<p>keep</p><script>var x = 1;</script><style>.a{color:red}</style>`;
    expect(renderedText(html)).toBe("keep");
  });

  test("decodes character entities in text", () => {
    const html = `<p>a &amp; b &lt; c</p>`;
    expect(renderedText(html)).toBe("a & b < c");
  });

  test("markdown-rendered emphasis contributes only its text (the migration key)", () => {
    // The stored text-quote is rendered text: **bold** renders as the word only.
    const html = `<p>make it <strong>bold</strong> now</p>`;
    expect(renderedText(html)).toBe("make it bold now");
  });

  test("empty fragment yields empty string", () => {
    expect(renderedText("")).toBe("");
  });
});

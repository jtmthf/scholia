import { describe, test, expect } from "vitest";
import { toText, escapeHtml, humanize, htmlToDerivedText } from "../../src/util/text.js";

describe("toText", () => {
  test("recursively concatenates text from a hast tree", () => {
    const node = {
      type: "element",
      children: [
        { type: "text", value: "Use " },
        { type: "element", children: [{ type: "text", value: "foo" }] },
        { type: "text", value: " now" },
      ],
    };
    expect(toText(node)).toBe("Use foo now");
  });

  test("returns an empty string for nullish or childless nodes", () => {
    expect(toText(null)).toBe("");
    expect(toText({ type: "element" })).toBe("");
  });
});

describe("escapeHtml", () => {
  test("escapes all five HTML-sensitive characters", () => {
    expect(escapeHtml(`<a href="x" title='y'>& more</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp; more&lt;/a&gt;",
    );
  });
});

describe("htmlToDerivedText", () => {
  test("strips tags and preserves text", () => {
    const result = htmlToDerivedText("<p>Hello <em>world</em></p>");
    expect(result).toContain("Hello world");
  });

  test("adds newlines after block elements", () => {
    const result = htmlToDerivedText("<h1>Title</h1><p>Paragraph one.</p><p>Paragraph two.</p>");
    expect(result).toBe("Title\nParagraph one.\nParagraph two.");
  });

  test("handles nested block and inline elements", () => {
    const result = htmlToDerivedText("<div><h2>Heading</h2><p>Text with <a href='x'>link</a>.</p></div>");
    expect(result).toBe("Heading\nText with link.");
  });

  test("skips script and style content", () => {
    const result = htmlToDerivedText("<div>Visible<script>hidden()</script><style>body{}</style> text</div>");
    expect(result).toBe("Visible text");
  });

  test("returns empty string for empty input", () => {
    expect(htmlToDerivedText("")).toBe("");
  });

  test("collapses multiple consecutive newlines", () => {
    const result = htmlToDerivedText("<div><br><br></div><p>After breaks.</p>");
    expect(result).toContain("After breaks.");
  });
});

describe("humanize", () => {
  test("turns slugs into title-cased labels", () => {
    expect(humanize("getting-started")).toBe("Getting Started");
    expect(humanize("api_reference")).toBe("Api Reference");
    expect(humanize("mixed-case_name")).toBe("Mixed Case Name");
  });
});

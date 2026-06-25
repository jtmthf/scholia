import { describe, test, expect } from "vitest";
import { toText, escapeHtml, humanize } from "../../src/util/text.js";

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

describe("humanize", () => {
  test("turns slugs into title-cased labels", () => {
    expect(humanize("getting-started")).toBe("Getting Started");
    expect(humanize("api_reference")).toBe("Api Reference");
    expect(humanize("mixed-case_name")).toBe("Mixed Case Name");
  });
});

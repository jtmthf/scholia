import { describe, test, expect } from "vitest";
import { renderMarkdown } from "../../src/render/markdown.js";

describe("renderMarkdown (full unified pipeline)", () => {
  test("derives the title from the first h1 and collects the table of contents", async () => {
    const { title, headings } = await renderMarkdown("# Welcome\n\n## First\n\n## Second\n");
    expect(title).toBe("Welcome");
    expect(headings).toEqual([
      { depth: 1, id: "welcome", text: "Welcome" },
      { depth: 2, id: "first", text: "First" },
      { depth: 2, id: "second", text: "Second" },
    ]);
  });

  test("frontmatter title overrides the first heading", async () => {
    const { title } = await renderMarkdown("---\ntitle: Override\n---\n# Heading\n");
    expect(title).toBe("Override");
  });

  test("renders GitHub-flavored markdown: tables, strikethrough, task lists", async () => {
    const { html } = await renderMarkdown(
      ["| A | B |", "| - | - |", "| 1 | 2 |", "", "~~gone~~", "", "- [x] done"].join("\n"),
    );
    expect(html).toContain("<table>");
    expect(html).toContain("<del>gone</del>");
    expect(html).toContain('type="checkbox"');
  });

  test("highlights fenced code blocks with Shiki", async () => {
    const { html } = await renderMarkdown("```js\nconst x = 1;\n```\n");
    expect(html).toContain("shiki");
    expect(html).toContain("const");
  });

  test("renders inline math with KaTeX", async () => {
    const { html } = await renderMarkdown("Euler: $e^{i\\pi} + 1 = 0$\n");
    expect(html).toContain("katex");
  });

  test('rewrites a ```mermaid block into a <pre class="mermaid"> the client can render', async () => {
    const { html } = await renderMarkdown("```mermaid\ngraph TD; A-->B;\n```\n");
    expect(html).toContain('class="mermaid"');
    expect(html).toContain("graph TD");
    // It must NOT be handed to Shiki as a normal code block.
    expect(html).not.toContain("language-mermaid");
  });

  test("does not throw on invalid math (renders the error inline instead)", async () => {
    await expect(renderMarkdown("$\\frac{1}{$\n")).resolves.toBeTruthy();
  });
});

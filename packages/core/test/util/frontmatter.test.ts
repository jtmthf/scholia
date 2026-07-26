import { describe, test, expect } from "vitest";
import { parseFrontmatter } from "../../src/util/frontmatter.js";

describe("parseFrontmatter", () => {
  test("extracts YAML data and returns the body without the fence", () => {
    const { data, content } = parseFrontmatter("---\ntitle: Hello\norder: 2\n---\n# Body\n\ntext");
    expect(data).toEqual({ title: "Hello", order: 2 });
    expect(content).toBe("# Body\n\ntext");
  });

  test("returns the whole document untouched when there is no frontmatter", () => {
    const raw = "# Just a heading\n\nno fence here";
    const { data, content } = parseFrontmatter(raw);
    expect(data).toEqual({});
    expect(content).toBe(raw);
  });

  test("never throws on malformed YAML — strips the fence and keeps the body", () => {
    const raw = '---\ntitle: "unterminated\n---\n# Body survives';
    const { data, content } = parseFrontmatter(raw);
    expect(data).toEqual({});
    expect(content).toBe("# Body survives");
  });
});

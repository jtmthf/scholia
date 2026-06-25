import { evaluate } from "@mdx-js/mdx";
import * as runtime from "preact/jsx-runtime";
import { h } from "preact";
import { render } from "preact-render-to-string";
import { parseFrontmatter } from "../util/frontmatter.js";
import { getHighlighter } from "./pipeline.js";
import { remarkPlugins, rehypePlugins } from "./plugins.js";
import type { Heading, RenderResult } from "../types.js";

// Render an .mdx document to static HTML. MDX executes arbitrary JS at render
// time; this is acceptable for a local tool serving the user's own trusted
// files. Rendered with Preact (lightweight) to a string — no client hydration.
export async function renderMdx(source: string, baseUrl: string): Promise<RenderResult> {
  const { data, content } = parseFrontmatter(source);
  const headings: Heading[] = [];
  const highlighter = await getHighlighter();

  const mod: any = await evaluate(content, {
    ...(runtime as any),
    baseUrl,
    remarkPlugins: remarkPlugins(),
    rehypePlugins: rehypePlugins(highlighter, headings),
  });

  const html = render(h(mod.default, {}));
  const title =
    (typeof data.title === "string" ? data.title : undefined) ??
    headings.find((hd) => hd.depth === 1)?.text;

  return { html, title, headings, data: data as Record<string, unknown> };
}

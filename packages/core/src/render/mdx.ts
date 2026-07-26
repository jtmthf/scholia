import { evaluate, type EvaluateOptions } from "@mdx-js/mdx";
import * as runtime from "preact/jsx-runtime";
import { h, type ComponentType } from "preact";
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

  // Preact's jsx-runtime is structurally MDX's `Fragment`/`jsx`/`jsxs` runtime
  // but isn't declared as it, so the runtime spread needs a cast — narrowed to
  // the three members MDX reads rather than widened to `any`.
  const mod = await evaluate(content, {
    ...(runtime as unknown as Pick<EvaluateOptions, "Fragment" | "jsx" | "jsxs">),
    baseUrl,
    remarkPlugins: remarkPlugins(),
    rehypePlugins: rehypePlugins(highlighter, headings),
  });

  const html = render(h(mod.default as ComponentType, {}));
  const title =
    (typeof data.title === "string" ? data.title : undefined) ??
    headings.find((hd) => hd.depth === 1)?.text;

  return { html, title, headings, data: data };
}

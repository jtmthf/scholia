import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import { parseFrontmatter } from "../util/frontmatter.js";
import { getHighlighter } from "./pipeline.js";
import { remarkPlugins, rehypePlugins } from "./plugins.js";
import type { Heading, RenderResult } from "../types.js";

export async function renderMarkdown(source: string): Promise<RenderResult> {
  const { data, content } = parseFrontmatter(source);
  const headings: Heading[] = [];
  const highlighter = await getHighlighter();

  const processor: any = unified().use(remarkParse);
  for (const plugin of remarkPlugins()) processor.use(plugin);
  // Allow inline HTML (<details>, <kbd>, tables, etc.) through. These are the
  // user's own local files, so we render raw HTML rather than dropping it.
  processor.use(remarkRehype, { allowDangerousHtml: true });
  processor.use(rehypeRaw);
  for (const plugin of rehypePlugins(highlighter, headings)) {
    if (Array.isArray(plugin)) processor.use(plugin[0], ...plugin.slice(1));
    else processor.use(plugin);
  }
  processor.use(rehypeStringify);

  const file = await processor.process(content);
  const html = String(file);
  const title =
    (typeof data.title === "string" ? data.title : undefined) ??
    headings.find((h) => h.depth === 1)?.text;

  return { html, title, headings, data: data as Record<string, unknown> };
}

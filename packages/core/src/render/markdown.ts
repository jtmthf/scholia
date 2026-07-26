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

  // `use` takes a PluggableList directly, so the shared plugin chains go in as
  // one unit — same order as before, and it keeps the processor's inferred type
  // instead of collapsing it to `any` the way the incremental loop did.
  const processor = unified()
    .use(remarkParse)
    .use(remarkPlugins())
    // Allow inline HTML (<details>, <kbd>, tables, etc.) through. These are the
    // user's own local files, so we render raw HTML rather than dropping it.
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypePlugins(highlighter, headings))
    .use(rehypeStringify);

  const file = await processor.process(content);
  const html = String(file);
  const title =
    (typeof data.title === "string" ? data.title : undefined) ??
    headings.find((h) => h.depth === 1)?.text;

  return { html, title, headings, data: data };
}

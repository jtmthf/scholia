import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import { parseFrontmatter } from "../util/frontmatter.js";
import { getHighlighter } from "../render/pipeline.js";
import { remarkPlugins, rehypePlugins } from "../render/plugins.js";
import {
  rehypeSourceMap,
  serializeSourceMap,
  type SourceMap,
  type SourceMapEntry,
} from "./source-map.js";
import type { Heading } from "../types.js";

export interface MarkdownIngest {
  /** Rendered HTML fragment, with `data-sm` ids stamped for anchoring. */
  html: string;
  title: string | undefined;
  headings: Heading[];
  /** Frontmatter. */
  data: Record<string, unknown>;
  /** Source Map: `data-sm` id -> source character range. */
  sourceMap: SourceMap;
}

// Ingest a Markdown Page for hosting: render to HTML and, in the same pass,
// build the Source Map. Shares the exact render pipeline as Local Preview
// (`renderMarkdown`) plus the `rehypeSourceMap` collector, so hosted HTML and
// previewed HTML stay byte-identical apart from the `data-sm` stamps.
export async function ingestMarkdown(source: string): Promise<MarkdownIngest> {
  const { data, content } = parseFrontmatter(source);
  const headings: Heading[] = [];
  const smEntries: SourceMapEntry[] = [];
  const highlighter = await getHighlighter();

  const processor = unified()
    .use(remarkParse)
    .use(remarkPlugins())
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    // Collect the Source Map first, while elements still carry their original
    // source `position` (slug/shiki passes below synthesize nodes and rewrite
    // code blocks, dropping positions).
    .use(rehypeSourceMap, smEntries)
    .use(rehypePlugins(highlighter, headings))
    .use(rehypeStringify);

  const file = await processor.process(content);
  const html = String(file);
  const title =
    (typeof data.title === "string" ? data.title : undefined) ??
    headings.find((h) => h.depth === 1)?.text;

  return {
    html,
    title,
    headings,
    data: data,
    sourceMap: serializeSourceMap(smEntries),
  };
}

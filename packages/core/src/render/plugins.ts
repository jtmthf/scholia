import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeShikiFromHighlighter from "@shikijs/rehype/core";
import type { Highlighter } from "shiki";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { remarkAlert } from "remark-github-blockquote-alert";
import { rehypeMermaid } from "./mermaid.js";
import { rehypeCollectToc } from "./toc.js";
import type { PluggableList } from "unified";
import { SHIKI_OPTIONS } from "./pipeline.js";
import type { Heading } from "../types.js";

export function remarkPlugins(): PluggableList {
  // remarkAlert adds GitHub-style admonitions (> [!NOTE], > [!WARNING], ...).
  return [remarkGfm, remarkMath, remarkAlert];
}

// Rehype chain shared by the markdown and MDX renderers. Order matters:
// mermaid pass-through and katex first, then slug -> toc collection ->
// autolink, with Shiki highlighting last over the remaining code blocks.
export function rehypePlugins(highlighter: Highlighter, headings: Heading[]): PluggableList {
  return [
    rehypeMermaid,
    // Render math errors inline (red) instead of throwing, and don't fail on
    // non-strict input (e.g. unicode dashes) — a viewer must stay resilient.
    [rehypeKatex, { throwOnError: false, strict: false }],
    rehypeSlug,
    [rehypeCollectToc, headings],
    [rehypeAutolinkHeadings, { behavior: "wrap" }],
    [rehypeShikiFromHighlighter, highlighter, SHIKI_OPTIONS],
  ];
}

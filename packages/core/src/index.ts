// @collab/core — pure domain logic shared by Local Preview and hosting:
// render, Nav, search, Entry Page precedence, content-addressed blobs.
// No HTTP, no db.

// Render
export { renderMarkdown } from "./render/markdown.js";
export { renderMdx } from "./render/mdx.js";
export { getHighlighter, SHIKI_THEMES, SHIKI_OPTIONS } from "./render/pipeline.js";

// Nav / ingest
export { scanTree, type ScanResult } from "./nav/tree.js";

// Markdown Page ingest for hosting: render + Source Map + content-addressed store.
export { ingestMarkdown, type MarkdownIngest } from "./ingest/markdown.js";
export { storeMarkdownPage, type StoredMarkdownPage } from "./ingest/store.js";
export {
  SOURCE_MAP_VERSION,
  SOURCE_MAP_ATTR,
  type SourceMap,
  type SourceMapEntry,
} from "./ingest/source-map.js";

// Search
export { createSearchIndex, type SearchIndex, type SearchHit } from "./search/index.js";

// Utils
export { parseFrontmatter, type Frontmatter } from "./util/frontmatter.js";
export { extractHeadings } from "./util/headings.js";
export { contentType } from "./util/mime.js";
export { isDoc, isMdx, toUrlPath, resolveWithinRoot } from "./util/paths.js";
export { toText, escapeHtml, humanize } from "./util/text.js";

// Types
export type { Heading, NavNode, DocRecord, RenderResult } from "./types.js";

// Content-addressed blob store
export * from "./blob/index.js";

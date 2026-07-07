// @collab/core — pure domain logic shared by Local Preview and hosting:
// render, Nav, search, Entry Page precedence, content-addressed blobs.
// No HTTP, no db.

// Render
export { renderMarkdown } from "./render/markdown.js";
export { renderMdx } from "./render/mdx.js";
export { getHighlighter, SHIKI_THEMES, SHIKI_OPTIONS } from "./render/pipeline.js";

// Nav / ingest
export { scanTree, type ScanResult } from "./nav/tree.js";
// Hosted Nav + Entry Page from a stored manifest (pure — no filesystem).
export { buildNav, pickEntryPath, type ManifestEntry } from "./nav/manifest.js";
// Serve-time inter-Page link rewriting for hosted Markdown Pages.
export { rewriteInterPageLinks, type RewriteLinkOptions } from "./ingest/links.js";

// Markdown Page ingest for hosting: render + Source Map + content-addressed store.
export { ingestMarkdown, type MarkdownIngest } from "./ingest/markdown.js";
// HTML Page ingest for hosting: parse5 + Source Map + content-addressed store (M4).
export { ingestHtml, type HtmlIngest } from "./ingest/html.js";
export {
  storeMarkdownPage,
  storeHtmlPage,
  type StoredPage,
  type StoredMarkdownPage,
} from "./ingest/store.js";
export {
  SOURCE_MAP_VERSION,
  SOURCE_MAP_ATTR,
  type SourceMap,
  type SourceMapEntry,
} from "./ingest/source-map.js";

// Anchoring (M5): text-quote primary, source-range secondary (ADR-0002).
export {
  searchQuote,
  mapSmIdsToSourceRange,
  migrateAnchor,
  type TextQuote,
  type SourceRange,
  type Anchor,
  type SelectionCandidate,
  type AnchorStatus,
  type MigrationResult,
} from "./anchor/index.js";

// Rendered-text extraction: the string cross-Version migration matches against (M6).
export { renderedText } from "./ingest/rendered-text.js";

// Source-level line diff between two Versions of a Page (M6, CONTEXT "Diff").
export {
  diffLines,
  type DiffLine,
  type DiffLineType,
  type LineDiff,
} from "./diff/lines.js";

// Search
export { createSearchIndex, type SearchIndex, type SearchHit } from "./search/index.js";

// Utils
export { parseFrontmatter, type Frontmatter } from "./util/frontmatter.js";
export { extractHeadings } from "./util/headings.js";
export { contentType } from "./util/mime.js";
export { classifyFile, isDoc, isMdx, toUrlPath, resolveWithinRoot } from "./util/paths.js";
export { toText, escapeHtml, humanize } from "./util/text.js";

// Types
export type { Heading, NavNode, DocRecord, RenderResult } from "./types.js";

// Content-addressed blob store
export * from "./blob/index.js";

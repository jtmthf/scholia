// Rendering one Page for Local Preview, and remembering the result.
//
// Two things separate this from a bare call to the render pipeline, and both are
// there for the comment layer:
//
// - **The rendered HTML carries `data-sm` stamps and a Source Map.** Local
//   Preview renders through the same `ingest*` functions the hosted path uses,
//   not the plain `renderMarkdown`, so a selection over the rendered DOM can be
//   mapped back to a range in the Source (CONTEXT "Source Map"). The HTML is
//   otherwise identical — the stamps are the only difference.
// - **The Source's content hash is computed here**, at render time, because that
//   is the moment a Comment's binding has to be taken from (CONTEXT "Comment"):
//   the reader is commenting on the bytes that produced what they are looking
//   at, not on whatever is on disk when they press the button.
//
// MDX is the exception and stays one: it renders through `renderMdx` and has no
// Source Map, so an Anchor on an MDX Page carries its text-quote and no source
// range. The quote is the primary locator either way (ADR-0002).

import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  classifyFile,
  hashBytes,
  ingestHtml,
  ingestMarkdown,
  isMdx,
  renderMdx,
  type Heading,
  type SourceMap,
} from "@scholia/core";

export type PageKind = "markdown" | "mdx" | "html";

export interface RenderedPage {
  kind: PageKind;
  /** Falls back to "scholia" when the Page names itself nothing. */
  title: string;
  /** The Page's content, ready to place inside the chrome's article element. */
  contentHtml: string;
  /**
   * An HTML Page's own `<style>`/`<link>` elements, for the chrome's head. Empty
   * for every other kind — a Markdown Page's styling is the chrome's.
   */
  styleHtml: string;
  headings: Heading[];
  /** The Page's Source, verbatim (CONTEXT "Source"). */
  source: string;
  /** null for MDX, which renders without one. */
  sourceMap: SourceMap | null;
  /** sha256 of `source` — the same hash a hosted Version records for this Page. */
  contentHash: string;
}

interface CacheEntry extends RenderedPage {
  mtimeMs: number;
}

const encoder = new TextEncoder();

function pageKind(fsPath: string, mdxEnabled: boolean): PageKind {
  if (mdxEnabled && isMdx(fsPath)) return "mdx";
  return classifyFile(fsPath) === "html" ? "html" : "markdown";
}

/**
 * Renders Pages and caches them by path + mtime, so repeat loads skip the
 * unified/Shiki/KaTeX pipeline entirely.
 */
export class PageRenderer {
  private mdxEnabled: boolean;
  private cache = new Map<string, CacheEntry>();

  constructor(opts: { mdxEnabled: boolean }) {
    this.mdxEnabled = opts.mdxEnabled;
  }

  /** Drop a path's cached render — the file changed underneath us. */
  invalidate(fsPath: string): void {
    this.cache.delete(fsPath);
  }

  /** Renders `fsPath`, or rejects the way the underlying pipeline did. */
  async render(fsPath: string): Promise<RenderedPage> {
    const info = await stat(fsPath).catch(() => null);
    const cached = this.cache.get(fsPath);
    if (cached && info && cached.mtimeMs === info.mtimeMs) return cached;

    const source = await readFile(fsPath, "utf8");
    const kind = pageKind(fsPath, this.mdxEnabled);
    const contentHash = hashBytes(encoder.encode(source));

    let page: RenderedPage;
    if (kind === "html") {
      // An HTML Page is trusted here in a way a hosted one is not: locally the
      // files are the reader's own, and Local Preview is already the surface
      // that executes MDX (ADR-0012). Its markup and its own stylesheets go into
      // the chrome document as they are — no sanitising, no frame.
      const ingest = ingestHtml(source);
      page = {
        kind,
        title: ingest.title ?? "scholia",
        contentHtml: ingest.bodyHtml,
        styleHtml: ingest.styleHtml,
        headings: ingest.headings,
        source,
        sourceMap: ingest.sourceMap,
        contentHash,
      };
    } else if (kind === "mdx") {
      const result = await renderMdx(source, pathToFileURL(fsPath).href);
      page = {
        kind,
        title: result.title ?? "scholia",
        contentHtml: result.html,
        styleHtml: "",
        headings: result.headings,
        source,
        sourceMap: null,
        contentHash,
      };
    } else {
      const ingest = await ingestMarkdown(source);
      page = {
        kind,
        title: ingest.title ?? "scholia",
        contentHtml: ingest.html,
        styleHtml: "",
        headings: ingest.headings,
        source,
        sourceMap: ingest.sourceMap,
        contentHash,
      };
    }

    if (info) this.cache.set(fsPath, { ...page, mtimeMs: info.mtimeMs });
    return page;
  }
}

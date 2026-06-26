import { ingestMarkdown } from "./markdown.js";
import { ingestHtml } from "./html.js";
import type { BlobStore } from "../blob/types.js";

const enc = new TextEncoder();

export interface StoredPage {
  /** sha256 of the raw source. */
  contentHash: string;
  /** sha256 of the rendered/served HTML. */
  renderedHash: string;
  /** sha256 of the serialized Source Map JSON. */
  sourceMapHash: string;
  /** First `<h1>`/`<title>`/frontmatter title, if any. */
  title: string | undefined;
}

/** @deprecated use {@link StoredPage}; kept as an alias for existing callers. */
export type StoredMarkdownPage = StoredPage;

// Ingest a Markdown Page and write all three immutable artifacts — raw source,
// rendered HTML, serialized Source Map — to the content-addressed blob store,
// returning their hashes for a `manifest_entries` row. Idempotent by content:
// re-storing identical bytes is a no-op (PLAN §3, ADR-0004).
export async function storeMarkdownPage(
  store: BlobStore,
  source: string,
): Promise<StoredPage> {
  const ingest = await ingestMarkdown(source);
  return storeArtifacts(store, source, ingest.html, ingest.sourceMap, ingest.title);
}

// Ingest an HTML Page (parse5 + Source Map, ADR-0003/0012) and write its three
// immutable artifacts — raw source, served HTML (with `data-sm` stamps), and the
// serialized Source Map — to the content-addressed store. Same shape as the
// Markdown path so a `manifest_entries` row is built identically.
export async function storeHtmlPage(
  store: BlobStore,
  source: string,
): Promise<StoredPage> {
  const ingest = ingestHtml(source);
  return storeArtifacts(store, source, ingest.html, ingest.sourceMap, ingest.title);
}

async function storeArtifacts(
  store: BlobStore,
  source: string,
  servedHtml: string,
  sourceMap: unknown,
  title: string | undefined,
): Promise<StoredPage> {
  const [content, rendered, sm] = await Promise.all([
    store.put(enc.encode(source)),
    store.put(enc.encode(servedHtml)),
    store.put(enc.encode(JSON.stringify(sourceMap))),
  ]);
  return {
    contentHash: content.hash,
    renderedHash: rendered.hash,
    sourceMapHash: sm.hash,
    title,
  };
}

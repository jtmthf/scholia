import { ingestMarkdown } from "./markdown.js";
import type { BlobStore } from "../blob/types.js";

const enc = new TextEncoder();

export interface StoredMarkdownPage {
  /** sha256 of the raw markdown source. */
  contentHash: string;
  /** sha256 of the rendered HTML fragment. */
  renderedHash: string;
  /** sha256 of the serialized Source Map JSON. */
  sourceMapHash: string;
  /** First `<h1>`/frontmatter title, if any. */
  title: string | undefined;
}

// Ingest a Markdown Page and write all three immutable artifacts — raw source,
// rendered HTML, serialized Source Map — to the content-addressed blob store,
// returning their hashes for a `manifest_entries` row. Idempotent by content:
// re-storing identical bytes is a no-op (PLAN §3, ADR-0004).
export async function storeMarkdownPage(
  store: BlobStore,
  source: string,
): Promise<StoredMarkdownPage> {
  const ingest = await ingestMarkdown(source);

  const [content, rendered, sourceMap] = await Promise.all([
    store.put(enc.encode(source)),
    store.put(enc.encode(ingest.html)),
    store.put(enc.encode(JSON.stringify(ingest.sourceMap))),
  ]);

  return {
    contentHash: content.hash,
    renderedHash: rendered.hash,
    sourceMapHash: sourceMap.hash,
    title: ingest.title,
  };
}

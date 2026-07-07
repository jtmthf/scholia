import { storeMarkdownPage, storeHtmlPage, type BlobStore } from "@collab/core";
import type { NewPage } from "@collab/db";

// The uploaded manifest wire shape shared by `POST /sites` (create) and
// `POST /sites/:slug/versions` (re-upload → new Version). Both first PUT every
// blob via /blobs, then submit this file list.
export interface FileEntry {
  path: string;
  kind: "markdown" | "html" | "asset";
  contentHash: string;
}

export function isFileEntry(v: unknown): v is FileEntry {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.path === "string" &&
    (obj.kind === "markdown" || obj.kind === "html" || obj.kind === "asset") &&
    typeof obj.contentHash === "string"
  );
}

// Which of the submitted content hashes are not yet in the blob store. A
// non-empty result means the client must upload them before the manifest is
// accepted (M3 content-hash negotiation).
export async function missingBlobs(
  store: BlobStore,
  files: FileEntry[],
): Promise<string[]> {
  const checks = await Promise.all(
    files.map(async (f) => ({ path: f.path, has: await store.has(f.contentHash) })),
  );
  return checks.filter((c) => !c.has).map((c) => c.path);
}

// Turn the uploaded file list into manifest rows: Markdown + HTML are Pages
// (rendered + Source Map'd from their stored source), everything else is a raw
// Asset. Idempotent by content hash (ADR-0004), so re-storing an unchanged Page
// across Versions is a no-op.
export async function buildManifestPages(
  store: BlobStore,
  files: FileEntry[],
): Promise<NewPage[]> {
  return Promise.all(
    files.map(async (f): Promise<NewPage> => {
      if (f.kind === "asset") {
        return { path: f.path, kind: "asset", contentHash: f.contentHash };
      }
      const raw = await store.get(f.contentHash);
      const source = new TextDecoder().decode(raw!);
      const stored =
        f.kind === "html"
          ? await storeHtmlPage(store, source)
          : await storeMarkdownPage(store, source);
      return {
        path: f.path,
        kind: f.kind,
        contentHash: f.contentHash,
        title: stored.title ?? null,
        renderedHash: stored.renderedHash,
        sourceMapHash: stored.sourceMapHash,
      };
    }),
  );
}

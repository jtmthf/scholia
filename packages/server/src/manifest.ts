import { storeMarkdownPage, storeHtmlPage, type BlobStore } from "@collab/core";
import type { NewPage } from "@collab/db";
import type { UploadLimits } from "./config.js";

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

// A rejected upload under operator retention/quota caps (M9, CONTEXT "Retention
// & limits"). The route turns this into a 413 with the clear `error` message an
// end user sees. `null` from checkUploadLimits means "accepted".
export interface LimitViolation {
  error: string;
}

// Enforce the operator upload caps (all default-unset). File count is checked
// against the manifest length; per-file and total-size caps sum the stored blob
// sizes (deduped by hash so a blob shared across Pages counts once toward the
// Site total, matching what is actually stored). Called after missingBlobs, so
// every referenced blob is present and `store.size` resolves. Returns the first
// violation, or null when the upload fits every configured cap.
export async function checkUploadLimits(
  store: BlobStore,
  files: FileEntry[],
  limits: UploadLimits,
): Promise<LimitViolation | null> {
  if (limits.maxFileCount !== undefined && files.length > limits.maxFileCount) {
    return {
      error: `too many files: ${files.length} exceeds the limit of ${limits.maxFileCount}`,
    };
  }

  const needFileCap = limits.maxFileBytes !== undefined;
  const needTotalCap = limits.maxSiteBytes !== undefined;
  if (!needFileCap && !needTotalCap) return null;

  const sizeByHash = new Map<string, number>();
  for (const hash of new Set(files.map((f) => f.contentHash))) {
    sizeByHash.set(hash, (await store.size(hash)) ?? 0);
  }

  if (needFileCap) {
    for (const f of files) {
      const size = sizeByHash.get(f.contentHash) ?? 0;
      if (size > limits.maxFileBytes!) {
        return {
          error: `file too large: ${f.path} is ${size} bytes, exceeds the limit of ${limits.maxFileBytes} bytes`,
        };
      }
    }
  }

  if (needTotalCap) {
    let total = 0;
    for (const size of sizeByHash.values()) total += size;
    if (total > limits.maxSiteBytes!) {
      return {
        error: `site too large: ${total} bytes exceeds the limit of ${limits.maxSiteBytes} bytes`,
      };
    }
  }

  return null;
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

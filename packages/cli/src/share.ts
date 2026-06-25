import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { collectFiles } from "./collect.js";
import { getProvenance } from "./provenance.js";
import { saveCredential } from "./credentials.js";

export interface ShareOptions {
  server: string;
}

interface DiffResponse {
  missing: string[];
}

interface SiteResponse {
  slug: string;
  shareUrl: string;
  token: string;
  entryPath: string;
}

async function apiFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, init).catch((err: Error) => {
    throw new Error(`network error reaching ${url}: ${err.message}`);
  });
}

// `collab share <path>` (PLAN §5 M3): collect all files from a local file,
// directory, or zip; negotiate with the blob store; upload missing blobs;
// create a hosted Site; persist the owner token; print the Share URL.
export async function share(target: string, options: ShareOptions): Promise<void> {
  const resolved = resolve(target);
  const server = options.server.replace(/\/+$/, "");

  const files = await collectFiles(resolved);
  if (files.length === 0) throw new Error(`no files found at ${target}`);

  // Negotiate which blobs the server already has
  const hashes = [...new Set(files.map((f) => f.contentHash))];
  const diffRes = await apiFetch(`${server}/blobs/diff`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hashes }),
  });
  if (!diffRes.ok)
    throw new Error(`/blobs/diff failed (${diffRes.status}): ${await diffRes.text()}`);
  const { missing } = (await diffRes.json()) as DiffResponse;

  // Upload only the missing blobs — deduped by content hash
  const byHash = new Map(files.map((f) => [f.contentHash, f.bytes]));
  for (const hash of missing) {
    const bytes = byHash.get(hash);
    if (!bytes) continue;
    const upRes = await apiFetch(`${server}/blobs/${hash}`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: bytes,
    });
    if (!upRes.ok)
      throw new Error(`PUT /blobs/${hash} failed (${upRes.status}): ${await upRes.text()}`);
  }

  // Best-effort git provenance (zip → cwd; file → its dirname; dir → itself)
  const isZip = resolved.toLowerCase().endsWith(".zip");
  let provenanceDir: string;
  if (isZip) {
    provenanceDir = process.cwd();
  } else {
    const info = await stat(resolved);
    provenanceDir = info.isFile() ? dirname(resolved) : resolved;
  }
  const provenance = await getProvenance(provenanceDir);

  // Create the Site with the full manifest
  const siteRes = await apiFetch(`${server}/sites`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contentSource: { kind: "local" },
      provenance,
      files: files.map(({ path, kind, contentHash }) => ({ path, kind, contentHash })),
    }),
  });
  if (!siteRes.ok)
    throw new Error(`POST /sites failed (${siteRes.status}): ${await siteRes.text()}`);

  const body = (await siteRes.json()) as SiteResponse;

  await saveCredential({
    slug: body.slug,
    shareUrl: body.shareUrl,
    token: body.token,
    server,
    createdAt: new Date().toISOString(),
  });

  const n = files.length;
  console.log(`\n  collab — published ${n} file${n === 1 ? "" : "s"}`);
  console.log(`  ➜  Share URL: ${body.shareUrl}`);
  console.log(`  ➜  Entry:     ${body.entryPath}`);
  console.log(`\n  Owner token saved to ~/.collab/credentials (keep it; it grants write access).\n`);
}

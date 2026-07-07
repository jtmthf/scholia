import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { collectFiles } from "./collect.js";
import { getProvenance } from "./provenance.js";
import { loadCredentials, saveCredential } from "./credentials.js";
import { readSiteLink, writeSiteLink } from "./site-link.js";

export interface ShareOptions {
  server: string;
  /** Force a brand-new Site even when a `.collab` marker exists. */
  forceNew?: boolean;
  /** Re-upload to this specific Site slug (overrides the marker). */
  site?: string;
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

interface VersionResponse {
  slug: string;
  shareUrl: string;
  version: number;
  entryPath: string;
  migration: { migrated: number; outdated: number };
}

async function apiFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, init).catch((err: Error) => {
    throw new Error(`network error reaching ${url}: ${err.message}`);
  });
}

// The directory whose `.collab` marker (and git provenance) governs this target:
// the directory itself for a folder, its parent for a single file, cwd for a zip.
async function linkDirFor(resolved: string): Promise<string> {
  if (resolved.toLowerCase().endsWith(".zip")) return process.cwd();
  const info = await stat(resolved);
  return info.isFile() ? dirname(resolved) : resolved;
}

// Upload every missing blob (deduped by content hash) after negotiating with the
// server, returning the file manifest to submit.
async function uploadBlobs(
  server: string,
  files: Awaited<ReturnType<typeof collectFiles>>,
): Promise<void> {
  const hashes = [...new Set(files.map((f) => f.contentHash))];
  const diffRes = await apiFetch(`${server}/blobs/diff`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hashes }),
  });
  if (!diffRes.ok)
    throw new Error(`/blobs/diff failed (${diffRes.status}): ${await diffRes.text()}`);
  const { missing } = (await diffRes.json()) as DiffResponse;

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
}

// `collab share <path>`: promotes local content to a hosted Site (ADR-0010). The
// FIRST share of a target mints a Site + owner token and drops a `.collab` marker;
// re-running `collab share` there uploads a NEW Version (CONTEXT "Version") using
// the stored owner token and migrates comments forward. `--new` forces a fresh
// Site; `--site <slug>` targets a specific one.
export async function share(target: string, options: ShareOptions): Promise<void> {
  const resolved = resolve(target);
  const server = options.server.replace(/\/+$/, "");

  const files = await collectFiles(resolved);
  if (files.length === 0) throw new Error(`no files found at ${target}`);

  const linkDir = await linkDirFor(resolved);

  // Decide create-vs-reupload: explicit --site, else the marker (unless --new).
  let targetSlug: string | undefined = options.site;
  if (!targetSlug && !options.forceNew) {
    const link = await readSiteLink(linkDir);
    if (link && link.server.replace(/\/+$/, "") === server) targetSlug = link.slug;
  }

  await uploadBlobs(server, files);
  const provenance = await getProvenance(linkDir);
  const manifest = files.map(({ path, kind, contentHash }) => ({ path, kind, contentHash }));

  if (targetSlug) {
    await reupload(server, targetSlug, manifest, provenance, linkDir);
  } else {
    await createSite(server, manifest, provenance, linkDir, files.length);
  }
}

async function createSite(
  server: string,
  files: Array<{ path: string; kind: string; contentHash: string }>,
  provenance: Awaited<ReturnType<typeof getProvenance>>,
  linkDir: string,
  fileCount: number,
): Promise<void> {
  const siteRes = await apiFetch(`${server}/sites`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contentSource: { kind: "local" }, provenance, files }),
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
  await writeSiteLink(linkDir, {
    slug: body.slug,
    server,
    shareUrl: body.shareUrl,
  }).catch(() => {
    // A marker is a convenience; failing to write it must not fail the share.
  });

  console.log(`\n  collab — published ${fileCount} file${fileCount === 1 ? "" : "s"}`);
  console.log(`  ➜  Share URL: ${body.shareUrl}`);
  console.log(`  ➜  Entry:     ${body.entryPath}`);
  console.log(
    `\n  Owner token saved to ~/.collab/credentials; a .collab marker was written so`,
  );
  console.log(`  re-running \`collab share\` here uploads a new Version.\n`);
}

async function reupload(
  server: string,
  slug: string,
  files: Array<{ path: string; kind: string; contentHash: string }>,
  provenance: Awaited<ReturnType<typeof getProvenance>>,
  linkDir: string,
): Promise<void> {
  const creds = await loadCredentials();
  const cred = creds[slug];
  if (!cred?.token) {
    throw new Error(
      `no owner token for Site "${slug}" in ~/.collab/credentials — cannot upload a new Version. ` +
        `Use \`--new\` to create a fresh Site instead.`,
    );
  }

  const res = await apiFetch(`${server}/sites/${slug}/versions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cred.token}`,
    },
    body: JSON.stringify({ contentSource: { kind: "local" }, provenance, files }),
  });
  if (!res.ok)
    throw new Error(`POST /sites/${slug}/versions failed (${res.status}): ${await res.text()}`);

  const body = (await res.json()) as VersionResponse;

  // Keep the marker fresh (server may differ from a hand-passed --site).
  await writeSiteLink(linkDir, {
    slug: body.slug,
    server,
    shareUrl: body.shareUrl,
  }).catch(() => {});

  const { migrated, outdated } = body.migration;
  console.log(`\n  collab — published Version ${body.version} of ${body.slug}`);
  console.log(`  ➜  Share URL: ${body.shareUrl}`);
  console.log(`  ➜  Comments:  ${migrated} migrated, ${outdated} now outdated\n`);
}

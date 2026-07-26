import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ScholiaClient, collectFiles, loadCredentials, saveCredential } from "@scholia/client";
import type { SiteCreatedResult, VersionAddedResult } from "@scholia/client";
import { getProvenance } from "@scholia/core";
import { readSiteLink, writeSiteLink } from "./site-link.js";

export interface ShareOptions {
  server: string;
  /** Force a brand-new Site even when a `.scholia` marker exists. */
  forceNew?: boolean;
  /** Re-upload to this specific Site slug (overrides the marker). */
  site?: string;
  /** PR content source: `owner/repo#123`. Server fetches bytes from GitHub. */
  pr?: string;
  /** Ref content source: `owner/repo@<ref>`. Server fetches bytes from GitHub. */
  ref?: string;
}

// Parse `owner/repo#123` into {repo, prNumber}.
function parsePrSpec(spec: string): { repo: string; prNumber: number } {
  const idx = spec.indexOf("#");
  if (idx < 0) throw new Error(`--pr expects "owner/repo#123" (got "${spec}")`);
  const repo = spec.slice(0, idx);
  const prNumber = Number(spec.slice(idx + 1));
  if (!Number.isInteger(prNumber) || prNumber < 1) throw new Error(`--pr PR number must be a positive integer (got "${spec}")`);
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error(`--pr repo must be "owner/repo" (got "${repo}")`);
  return { repo, prNumber };
}

// Parse `owner/repo@<ref>` into {repo, ref}.
function parseRefSpec(spec: string): { repo: string; ref: string } {
  const idx = spec.indexOf("@");
  if (idx < 0) throw new Error(`--ref expects "owner/repo@<ref>" (got "${spec}")`);
  const repo = spec.slice(0, idx);
  const ref = spec.slice(idx + 1);
  if (!ref) throw new Error(`--ref ref must not be empty (got "${spec}")`);
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error(`--ref repo must be "owner/repo" (got "${repo}")`);
  return { repo, ref };
}

// The directory whose `.scholia` marker (and git provenance) governs this target:
// the directory itself for a folder, its parent for a single file, cwd for a zip.
async function linkDirFor(resolved: string): Promise<string> {
  if (resolved.toLowerCase().endsWith(".zip")) return process.cwd();
  const info = await stat(resolved);
  return info.isFile() ? dirname(resolved) : resolved;
}

// `scholia share <path>`: promotes local content to a hosted Site (ADR-0010). The
// FIRST share of a target mints a Site + owner token and drops a `.scholia` marker;
// re-running `scholia share` there uploads a NEW Version (CONTEXT "Version") using
// the stored owner token and migrates comments forward. `--new` forces a fresh
// Site; `--site <slug>` targets a specific one.
//
// `scholia share --pr owner/repo#123` and `scholia share --ref owner/repo@<ref>`
// create a Site from a GitHub content source — the server fetches the bytes, so no
// local path is needed (ADR-0009). Re-running re-fetches and appends a Version.
export async function share(target: string | undefined, options: ShareOptions): Promise<void> {
  const server = options.server.replace(/\/+$/, "");

  // Content-source branch: --pr or --ref (server-side fetch, no local files).
  if (options.pr || options.ref) {
    const source = options.pr
      ? { kind: "pr" as const, ...parsePrSpec(options.pr) }
      : { kind: "ref" as const, ...parseRefSpec(options.ref!) };

    // PR/ref-backed Sites don't have a local linkDir for a .scholia marker. We
    // key re-upload on --site (stored credential) just like the local path.
    let targetSlug: string | undefined = options.site;
    if (!targetSlug && !options.forceNew) {
      // No filesystem marker for ref/pr sources; --site is the only way back.
      // A stored credential from a prior `share --pr` is found via --site.
    }

    const client = new ScholiaClient({ server });
    if (targetSlug) {
      await refetchSource(server, targetSlug, source);
    } else {
      await createSiteFromSource(client, server, source);
    }
    return;
  }

  if (!target) throw new Error("expected a path, or --pr/--ref to create from a GitHub content source");
  const resolved = resolve(target);

  const files = await collectFiles(resolved);
  if (files.length === 0) throw new Error(`no files found at ${target}`);

  const linkDir = await linkDirFor(resolved);

  // Decide create-vs-reupload: explicit --site, else the marker (unless --new).
  let targetSlug: string | undefined = options.site;
  if (!targetSlug && !options.forceNew) {
    const link = await readSiteLink(linkDir);
    if (link && link.server.replace(/\/+$/, "") === server) targetSlug = link.slug;
  }

  const client = new ScholiaClient({ server });
  await client.uploadBlobs(files);
  const provenance = await getProvenance(linkDir);

  if (targetSlug) {
    await reupload(server, targetSlug, files, provenance, linkDir);
  } else {
    await createSite(client, server, files, provenance, linkDir, files.length);
  }
}

async function createSite(
  client: ScholiaClient,
  server: string,
  files: Awaited<ReturnType<typeof collectFiles>>,
  provenance: Awaited<ReturnType<typeof getProvenance>>,
  linkDir: string,
  fileCount: number,
): Promise<void> {
  const body: SiteCreatedResult = await client.createSite(files, provenance);

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

  console.log(`\n  scholia — published ${fileCount} file${fileCount === 1 ? "" : "s"}`);
  console.log(`  ➜  Share URL: ${body.shareUrl}`);
  console.log(`  ➜  Entry:     ${body.entryPath}`);
  console.log(
    `\n  Owner token saved to ~/.scholia/credentials; a .scholia marker was written so`,
  );
  console.log(`  re-running \`scholia share\` here uploads a new Version.\n`);
}

async function reupload(
  server: string,
  slug: string,
  files: Awaited<ReturnType<typeof collectFiles>>,
  provenance: Awaited<ReturnType<typeof getProvenance>>,
  linkDir: string,
): Promise<void> {
  const creds = await loadCredentials();
  const cred = creds[slug];
  if (!cred?.token) {
    throw new Error(
      `no owner token for Site "${slug}" in ~/.scholia/credentials — cannot upload a new Version. ` +
        `Use \`--new\` to create a fresh Site instead.`,
    );
  }

  const client = new ScholiaClient({ server, token: cred.token });
  const body: VersionAddedResult = await client.addVersion(slug, files, provenance);

  // Keep the marker fresh (server may differ from a hand-passed --site).
  await writeSiteLink(linkDir, {
    slug: body.slug,
    server,
    shareUrl: body.shareUrl,
  }).catch(() => {});

  const { migrated, outdated } = body.migration;
  console.log(`\n  scholia — published Version ${body.version} of ${body.slug}`);
  console.log(`  ➜  Share URL: ${body.shareUrl}`);
  console.log(`  ➜  Comments:  ${migrated} migrated, ${outdated} now outdated\n`);
}

// Create a Site from a GitHub content source (--pr or --ref). The server fetches
// bytes; the client just sends the content source spec. Provenance is clean
// (pinned ref/PR head) so we don't collect local git facts.
async function createSiteFromSource(
  client: ScholiaClient,
  server: string,
  source: { kind: "pr"; repo: string; prNumber: number } | { kind: "ref"; repo: string; ref: string },
): Promise<void> {
  const body: SiteCreatedResult = await client.createSiteFromSource(source);

  await saveCredential({
    slug: body.slug,
    shareUrl: body.shareUrl,
    token: body.token,
    server,
    createdAt: new Date().toISOString(),
  });

  const label = source.kind === "pr" ? `PR ${source.repo}#${source.prNumber}` : `${source.repo}@${source.ref}`;
  console.log(`\n  scholia — published from ${label}`);
  console.log(`  ➜  Share URL: ${body.shareUrl}`);
  console.log(`  ➜  Entry:     ${body.entryPath}`);
  if (body.mirrorBinding) console.log(`  ➜  Mirror:    ${body.mirrorBinding.repo}#${body.mirrorBinding.prNumber}`);
  console.log(`\n  Owner token saved to ~/.scholia/credentials.`);
  if (source.kind === "pr") {
    console.log(`  Re-run \`scholia share --pr ${source.repo}#${source.prNumber} --site ${body.slug}\` to advance.\n`);
  } else {
    console.log(`  Re-run \`scholia share --ref ${source.repo}@${source.ref} --site ${body.slug}\` to advance.\n`);
  }
}

// Re-fetch a GitHub content source and append a new Version (owner-authed).
async function refetchSource(
  server: string,
  slug: string,
  source: { kind: "pr"; repo: string; prNumber: number } | { kind: "ref"; repo: string; ref: string },
): Promise<void> {
  const creds = await loadCredentials();
  const cred = creds[slug];
  if (!cred?.token) {
    throw new Error(
      `no owner token for Site "${slug}" in ~/.scholia/credentials — cannot upload a new Version. ` +
        `Use \`--new\` to create a fresh Site instead.`,
    );
  }

  const client = new ScholiaClient({ server, token: cred.token });
  const body: VersionAddedResult = await client.refetchSource(slug, source);

  const { migrated, outdated } = body.migration;
  console.log(`\n  scholia — published Version ${body.version} of ${body.slug}`);
  console.log(`  ➜  Share URL: ${body.shareUrl}`);
  console.log(`  ➜  Comments:  ${migrated} migrated, ${outdated} now outdated\n`);
}

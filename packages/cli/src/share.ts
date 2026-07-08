import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { CollabClient, collectFiles, loadCredentials, saveCredential } from "@collab/client";
import type { SiteCreatedResult, VersionAddedResult } from "@collab/client";
import { getProvenance } from "./provenance.js";
import { readSiteLink, writeSiteLink } from "./site-link.js";

export interface ShareOptions {
  server: string;
  /** Force a brand-new Site even when a `.collab` marker exists. */
  forceNew?: boolean;
  /** Re-upload to this specific Site slug (overrides the marker). */
  site?: string;
}

// The directory whose `.collab` marker (and git provenance) governs this target:
// the directory itself for a folder, its parent for a single file, cwd for a zip.
async function linkDirFor(resolved: string): Promise<string> {
  if (resolved.toLowerCase().endsWith(".zip")) return process.cwd();
  const info = await stat(resolved);
  return info.isFile() ? dirname(resolved) : resolved;
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

  const client = new CollabClient({ server });
  await client.uploadBlobs(files);
  const provenance = await getProvenance(linkDir);

  if (targetSlug) {
    await reupload(server, targetSlug, files, provenance, linkDir);
  } else {
    await createSite(client, server, files, provenance, linkDir, files.length);
  }
}

async function createSite(
  client: CollabClient,
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
  files: Awaited<ReturnType<typeof collectFiles>>,
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

  const client = new CollabClient({ server, token: cred.token });
  const body: VersionAddedResult = await client.addVersion(slug, files, provenance);

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

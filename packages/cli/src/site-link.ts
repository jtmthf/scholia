import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// A `.collab` marker links a local target to the hosted Site it was shared as, so
// re-running `collab share` in the same place uploads a new Version rather than
// minting a fresh Site (CONTEXT "Version": re-uploading creates a new Version).
// It's a project-local pointer, NOT a credential — the owner token stays in
// ~/.collab/credentials — so it's safe to commit alongside the docs.
const MARKER = ".collab";

export interface SiteLink {
  slug: string;
  server: string;
  shareUrl: string;
}

function markerPath(dir: string): string {
  return join(dir, MARKER);
}

// Read the `.collab` marker in `dir`, or null when absent/unparseable.
export async function readSiteLink(dir: string): Promise<SiteLink | null> {
  try {
    const raw = await readFile(markerPath(dir), "utf8");
    const parsed = JSON.parse(raw) as Partial<SiteLink>;
    if (typeof parsed.slug === "string" && typeof parsed.server === "string") {
      return {
        slug: parsed.slug,
        server: parsed.server,
        shareUrl: parsed.shareUrl ?? "",
      };
    }
    return null;
  } catch {
    return null;
  }
}

// Write (or overwrite) the `.collab` marker in `dir`.
export async function writeSiteLink(dir: string, link: SiteLink): Promise<void> {
  await writeFile(markerPath(dir), JSON.stringify(link, null, 2) + "\n");
}

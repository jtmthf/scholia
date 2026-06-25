import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { saveCredential } from "./credentials.js";

export interface ShareOptions {
  server: string;
}

interface ShareResponse {
  slug: string;
  shareUrl: string;
  token: string;
  page: { path: string; title: string };
}

// `collab share <file.md>` (PLAN §5 M2): upload a single Markdown file, host it
// as a public Site, persist the owner token, and print the Share URL. Folders
// and zips are M3.
export async function share(target: string, options: ShareOptions): Promise<void> {
  const file = resolve(target);

  const info = await stat(file).catch(() => null);
  if (!info) throw new Error(`not found: ${file}`);
  if (info.isDirectory()) {
    throw new Error("folders are not supported yet — share a single .md file (folders land in M3)");
  }
  if (!/\.(md|markdown)$/i.test(file)) {
    throw new Error("only Markdown files (.md) are supported in this version");
  }

  const content = await readFile(file, "utf8");
  const server = options.server.replace(/\/+$/, "");

  const res = await fetch(`${server}/sites`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: basename(file), content }),
  }).catch((err) => {
    throw new Error(`could not reach collab server at ${server}: ${err.message}`);
  });

  if (!res.ok) {
    throw new Error(`upload failed (${res.status}): ${await res.text()}`);
  }

  const body = (await res.json()) as ShareResponse;
  await saveCredential({
    slug: body.slug,
    shareUrl: body.shareUrl,
    token: body.token,
    server,
    createdAt: new Date().toISOString(),
  });

  console.log(`\n  collab — published "${body.page.title}"`);
  console.log(`  ➜  Share URL: ${body.shareUrl}`);
  console.log(`\n  Owner token saved to ~/.collab/credentials (keep it; it grants write access).\n`);
}

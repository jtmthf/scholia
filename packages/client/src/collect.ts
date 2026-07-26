import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { unzipSync } from "fflate";
import { classifyFile, hashBytes } from "@scholia/core";

export interface CollectedFile {
  path: string;
  kind: "markdown" | "html" | "asset";
  contentHash: string;
  bytes: Uint8Array<ArrayBuffer>;
}

function shouldSkip(segment: string): boolean {
  return segment.startsWith(".") || segment === "node_modules";
}

async function walkDir(dir: string, prefix: string, out: CollectedFile[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldSkip(entry.name)) continue;
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walkDir(join(dir, entry.name), relPath, out);
    } else if (entry.isFile()) {
      const bytes = new Uint8Array(await readFile(join(dir, entry.name)));
      out.push({
        path: relPath,
        kind: classifyFile(relPath),
        contentHash: hashBytes(bytes),
        bytes,
      });
    }
  }
}

export async function collectFiles(target: string): Promise<CollectedFile[]> {
  if (target.toLowerCase().endsWith(".zip")) {
    const zipBytes = new Uint8Array(await readFile(target));
    const entries = unzipSync(zipBytes);
    const result: CollectedFile[] = [];
    for (const [rawPath, bytes] of Object.entries(entries)) {
      const archivePath = rawPath.replace(/\\/g, "/");
      if (archivePath.endsWith("/")) continue;
      if (archivePath.split("/").some(shouldSkip)) continue;
      result.push({
        path: archivePath,
        kind: classifyFile(archivePath),
        contentHash: hashBytes(bytes),
        bytes,
      });
    }
    return result;
  }

  const info = await stat(target).catch(() => null);
  if (!info) throw new Error(`not found: ${target}`);

  if (info.isDirectory()) {
    const result: CollectedFile[] = [];
    await walkDir(target, "", result);
    return result;
  }

  const bytes = new Uint8Array(await readFile(target));
  const name = basename(target);
  return [{ path: name, kind: classifyFile(name), contentHash: hashBytes(bytes), bytes }];
}

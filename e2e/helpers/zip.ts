import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { zipSync } from "fflate";

// Build a .zip of a fixture directory at runtime (rather than committing a binary
// blob that can drift from the source tree) so the zip-ingest path can be
// exercised against the same content as the folder path.
export async function zipFixture(dir: string): Promise<string> {
  const files: Record<string, Uint8Array> = {};
  for (const abs of await walk(dir)) {
    const rel = relative(dir, abs).split(sep).join("/");
    files[rel] = new Uint8Array(await readFile(abs));
  }
  const out = join(await mkdtemp(join(tmpdir(), "scholia-e2e-zip-")), "site.zip");
  await writeFile(out, zipSync(files));
  return out;
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(abs)));
    else out.push(abs);
  }
  return out;
}

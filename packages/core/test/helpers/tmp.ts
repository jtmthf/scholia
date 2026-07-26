import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { test as base } from "vitest";

export interface TmpDir {
  /** Absolute path to the freshly created temp directory. */
  root: string;
  /** Write a file (creating parent dirs) at a path relative to `root`. */
  write(relPath: string, contents: string | Uint8Array): Promise<string>;
}

// A per-test temp directory, auto-removed on teardown. Preferred over a shared
// `fixtures/` dir so each test controls exactly the files it relies on.
export const test = base.extend<{ tmp: TmpDir }>({
  tmp: async ({}, use) => {
    const root = await mkdtemp(join(tmpdir(), "scholia-test-"));
    const api: TmpDir = {
      root,
      async write(relPath, contents) {
        const full = join(root, relPath);
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, contents);
        return full;
      },
    };
    await use(api);
    await rm(root, { recursive: true, force: true });
  },
});

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsBlobStore, hashBytes } from "../../src/index.js";

// M9: BlobStore.size — cheap metadata lookup used by the server's upload caps.
describe("FsBlobStore.size", () => {
  let dir: string;
  let store: FsBlobStore;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "collab-blob-size-"));
    store = new FsBlobStore(dir);
  });
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test("returns byte length of a stored blob", async () => {
    const bytes = new TextEncoder().encode("hello world");
    await store.put(bytes);
    expect(await store.size(hashBytes(bytes))).toBe(bytes.length);
  });

  test("returns null for an absent blob", async () => {
    const missing = hashBytes(new TextEncoder().encode("not stored " + Math.random()));
    expect(await store.size(missing)).toBeNull();
  });

  test("returns null for an invalid hash", async () => {
    expect(await store.size("not-a-hash")).toBeNull();
  });
});

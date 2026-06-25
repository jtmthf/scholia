import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { hashBytes, isValidHash, shardedKey } from "./hash.js";
import type { BlobStore, PutResult } from "./types.js";

// Local-filesystem blob store. The default for `docker compose`-free dev and a
// drop-in for the S3 store. Writes go to a temp file then atomically rename
// into place, so a concurrent reader never sees a half-written blob.
export class FsBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  private pathFor(hash: string): string {
    return join(this.root, shardedKey(hash));
  }

  async put(data: Uint8Array): Promise<PutResult> {
    const hash = hashBytes(data);
    const dest = this.pathFor(hash);

    if (await this.has(hash)) {
      return { hash, size: data.byteLength, existed: true };
    }

    await mkdir(dirname(dest), { recursive: true });
    const tmp = `${dest}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, dest);
    return { hash, size: data.byteLength, existed: false };
  }

  async get(hash: string): Promise<Uint8Array | null> {
    if (!isValidHash(hash)) return null;
    try {
      const buf = await readFile(this.pathFor(hash));
      return new Uint8Array(buf);
    } catch {
      return null;
    }
  }

  async has(hash: string): Promise<boolean> {
    if (!isValidHash(hash)) return false;
    try {
      await stat(this.pathFor(hash));
      return true;
    } catch {
      return false;
    }
  }
}

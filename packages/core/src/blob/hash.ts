import { createHash } from "node:crypto";
import { CONTENT_HASH_ALGO } from "./types.js";

// Lowercase hex sha256 — the content address for a blob.
export function hashBytes(data: Uint8Array): string {
  return createHash(CONTENT_HASH_ALGO).update(data).digest("hex");
}

const HASH_RE = /^[0-9a-f]{64}$/;

export function isValidHash(hash: string): boolean {
  return HASH_RE.test(hash);
}

// Shard a hash into `ab/cdef…` so a filesystem store doesn't pile every blob
// into one directory. Used by FsBlobStore and (as a key prefix) S3BlobStore.
export function shardedKey(hash: string): string {
  return `${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`;
}

import { createHash } from "node:crypto";
import { CONTENT_HASH_ALGO } from "./types.js";

// Lowercase hex sha256 — the content address for a blob.
export function hashBytes(data: Uint8Array): string {
  return createHash(CONTENT_HASH_ALGO).update(data).digest("hex");
}

export { isValidHash, shardedKey } from "./hash-utils.js";

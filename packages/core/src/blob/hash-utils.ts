const HASH_RE = /^[0-9a-f]{64}$/;

export function isValidHash(hash: string): boolean {
  return HASH_RE.test(hash);
}

export function shardedKey(hash: string): string {
  return `${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`;
}

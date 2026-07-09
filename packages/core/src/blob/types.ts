// Content-addressed blob storage (ADR-0004). Immutable bytes — raw sources,
// rendered HTML, serialized Source Maps — are keyed by their sha256 so the
// same content is stored once and the wire transfer can be hash-negotiated.

export const CONTENT_HASH_ALGO = "sha256" as const;

export interface BlobRef {
  /** Lowercase hex sha256 of the content. */
  hash: string;
  /** Byte length. */
  size: number;
}

export interface PutResult extends BlobRef {
  /** True when an identical blob was already stored (the put was a no-op). */
  existed: boolean;
}

export interface BlobStore {
  /** Store bytes; returns their content hash. Idempotent by hash. */
  put(data: Uint8Array): Promise<PutResult>;
  /** Fetch bytes by hash, or null if absent. */
  get(hash: string): Promise<Uint8Array | null>;
  /** Whether a blob with this hash is present. */
  has(hash: string): Promise<boolean>;
  /** Byte length of a stored blob, or null if absent. Cheap metadata lookup
   * (no full read) so the server can enforce size caps without downloading. */
  size(hash: string): Promise<number | null>;
}

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { hashBytes, isValidHash, shardedKey } from "./hash.js";
import type { BlobStore, PutResult } from "./types.js";

export interface S3BlobStoreConfig {
  bucket: string;
  /** Optional key prefix within the bucket. */
  prefix?: string;
  /** Custom endpoint (MinIO/R2). Omit for AWS S3. */
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** MinIO and most non-AWS S3 impls require path-style addressing. */
  forcePathStyle?: boolean;
}

// S3-compatible blob store: MinIO locally, R2/S3 in prod (ADR-0004). Same
// content-addressing as FsBlobStore — the key is the sharded sha256.
export class S3BlobStore implements BlobStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(config: S3BlobStoreConfig) {
    this.bucket = config.bucket;
    this.prefix = config.prefix ? config.prefix.replace(/\/+$/, "") + "/" : "";
    this.client = new S3Client({
      ...(config.region ? { region: config.region } : {}),
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      ...(config.forcePathStyle ? { forcePathStyle: true } : {}),
      ...(config.accessKeyId && config.secretAccessKey
        ? {
            credentials: {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            },
          }
        : {}),
    });
  }

  private keyFor(hash: string): string {
    return this.prefix + shardedKey(hash);
  }

  async put(data: Uint8Array): Promise<PutResult> {
    const hash = hashBytes(data);
    if (await this.has(hash)) {
      return { hash, size: data.byteLength, existed: true };
    }
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: this.keyFor(hash), Body: data }),
    );
    return { hash, size: data.byteLength, existed: false };
  }

  async get(hash: string): Promise<Uint8Array | null> {
    if (!isValidHash(hash)) return null;
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.keyFor(hash) }),
      );
      const bytes = await res.Body?.transformToByteArray();
      return bytes ? new Uint8Array(bytes) : null;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async has(hash: string): Promise<boolean> {
    if (!isValidHash(hash)) return false;
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.keyFor(hash) }),
      );
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }
}

function isNotFound(err: unknown): boolean {
  const meta = (err as { $metadata?: { httpStatusCode?: number }; name?: string }) ?? {};
  return (
    meta.$metadata?.httpStatusCode === 404 ||
    meta.name === "NotFound" ||
    meta.name === "NoSuchKey"
  );
}

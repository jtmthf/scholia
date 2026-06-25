import { createDb, type Db } from "@collab/db";
import { S3BlobStore, type BlobStore } from "@collab/core";

// Everything a request handler needs that touches the outside world: the db, the
// blob store, and the two public base URLs used to build links. Injectable so
// tests can pass an FsBlobStore + ephemeral db (PLAN §7).
export interface AppDeps {
  db: Db;
  store: BlobStore;
  /** Public base URL of this server — used to build content-origin URLs. */
  publicUrl: string;
  /** Base URL of the viewer SPA — used to build Share URLs (ADR-0005). */
  viewerUrl: string;
}

function blobStoreFromEnv(): BlobStore {
  return new S3BlobStore({
    bucket: process.env.S3_BUCKET ?? "collab-blobs",
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  });
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

// Build deps from environment. Called lazily on first use so importing the app
// (e.g. for the health check in tests) never requires DATABASE_URL or S3.
export function depsFromEnv(): AppDeps {
  return {
    db: createDb(),
    store: blobStoreFromEnv(),
    publicUrl: stripTrailingSlash(process.env.PUBLIC_URL ?? "http://localhost:8787"),
    viewerUrl: stripTrailingSlash(process.env.VIEWER_URL ?? "http://localhost:5173"),
  };
}

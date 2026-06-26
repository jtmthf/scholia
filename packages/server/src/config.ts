import { createDb, type Db } from "@collab/db";
import { S3BlobStore, type BlobStore } from "@collab/core";

// Everything a request handler needs that touches the outside world: the db, the
// blob store, and the two public base URLs used to build links. Injectable so
// tests can pass an FsBlobStore + ephemeral db (PLAN §7).
export interface AppDeps {
  db: Db;
  store: BlobStore;
  /** Public base URL of this server (the app origin + REST API). */
  publicUrl: string;
  /** Base URL of the viewer SPA — used to build Share URLs (ADR-0005). */
  viewerUrl: string;
  /**
   * Base URL of the content origin (ADR-0003) — where Page HTML + Assets are
   * served into the sandboxed iframe. Distinct from the app origin so untrusted
   * page JS can't reach the API or app-origin storage. Defaults to `publicUrl`
   * (path-based serving) for local dev/test where a separate origin isn't set up.
   */
  contentUrl: string;
  /**
   * When true, the content base for a Site becomes a per-Site subdomain
   * (`<slug>.<content-host>`), giving each Site its own opaque origin so one
   * Site's page JS can't script another's. Requires wildcard DNS/TLS in prod;
   * for local testing use a wildcard proxy such as vercel-labs/portless. Off by
   * default (path-based fallback) so CI/Playwright don't need wildcard DNS.
   */
  contentWildcard: boolean;
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
  const publicUrl = stripTrailingSlash(process.env.PUBLIC_URL ?? "http://localhost:8787");
  return {
    db: createDb(),
    store: blobStoreFromEnv(),
    publicUrl,
    viewerUrl: stripTrailingSlash(process.env.VIEWER_URL ?? "http://localhost:5173"),
    contentUrl: stripTrailingSlash(process.env.CONTENT_URL ?? publicUrl),
    contentWildcard: process.env.CONTENT_WILDCARD === "true",
  };
}

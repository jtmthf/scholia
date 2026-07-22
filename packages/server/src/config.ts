import { createDb, type Db } from "@collab/db";
import { S3BlobStore, type BlobStore, type MirrorProvider } from "@collab/core";
import {
  FixedWindowRateLimiter,
  NoopRateLimiter,
  PostgresRateLimiter,
  type RateLimiter,
} from "./rate-limit.js";
import { buildMirrorContext } from "./mirror/context.js";
import { createMirrorBus, type MirrorBus } from "./mirror/bus.js";
import {
  githubFromEnv,
  loadMirrorProviders,
  type GitHubOperatorConfig,
} from "./github-config.js";

// Operator retention/quota knobs (CONTEXT "Retention & limits", PLAN §5 M9). All
// default-unset — infinite retention — and enforced only at upload time with a
// clear rejection error. End users never configure these; only operators do.
export interface UploadLimits {
  /** Max bytes for any single uploaded blob. Undefined = unlimited. */
  maxFileBytes?: number;
  /** Max total bytes across a Version's manifest. Undefined = unlimited. */
  maxSiteBytes?: number;
  /** Max number of files (Pages + Assets) in a Version. Undefined = unlimited. */
  maxFileCount?: number;
}

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
   * default (path-based fallback) so CI/Playwright don't need wildcard DNS. The
   * Vercel adapter (M11, ADR-0015) forces this on — a multi-tenant hosted
   * deployment requires per-Site origin isolation.
   */
  contentWildcard: boolean;
  /**
   * Per-Viewer/IP rate limiter for comment creation (M9). On by default; a
   * NoopRateLimiter disables it. Injectable so a multi-instance deploy can swap
   * a shared store (M11: `PostgresRateLimiter`) and tests can supply a tiny
   * window or a no-op.
   */
  rateLimiter: RateLimiter;
  /** Operator upload caps (M9). All default-unset (infinite retention). */
  limits: UploadLimits;
  /**
   * Mirror providers registered for this instance (M10). Empty for non-PR-backed
   * deployments — the no-config promise is untouched. The GitHub provider is
   * constructed only when `GITHUB_APP_ID` + a private key are configured.
   */
  mirror: MirrorProvider[];
  /**
   * The outbound mirror bus (M10). `noopMirrorBus` when no providers are
   * registered. Routes emit to it; the bus attempts one inline dispatch per
   * event (M11, ADR-0015) — `runMirrorDrain` owns retry via periodic sweep.
   */
  mirrorBus: MirrorBus;
  /** Operator GitHub config (M10) — null when GitHub integration is off. */
  github: GitHubOperatorConfig | null;
  /**
   * Bearer secret gating `POST/GET /internal/drain` (M11, ADR-0015) — the
   * platform-agnostic trigger for the outbound-drain + inbound-reconcile
   * sweep. Null disables the route (404), matching the GitHub webhook route's
   * disabled-when-unconfigured pattern.
   */
  internalSecret: string | null;
}

// Parse a positive-integer env var, or undefined when unset/invalid (an invalid
// value must not silently become a cap — default is "no limit"). Exported for
// the Vercel adapter, which reuses it to parse the same rate-limit knobs while
// forcing the Postgres implementation.
export function intEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

// ---- Per-resource builders (ADR-0015) ----
// Each builder reads only the env it needs and is independently testable.
// `depsFromEnv()` composes all of them unchanged for self-host; a platform
// adapter (e.g. the Vercel adapter) composes its own subset instead of
// layering overrides onto an opaque function.

// `options` passes through to postgres-js (e.g. `{ max: 1 }` for a
// serverless-function-sized pool) — a caller decision, not a default here.
export function dbFromEnv(options?: Parameters<typeof createDb>[1]): Db {
  return createDb(process.env.DATABASE_URL, options);
}

export function storeFromEnv(): BlobStore {
  return new S3BlobStore({
    bucket: process.env.S3_BUCKET ?? "collab-blobs",
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  });
}

export type Urls = Pick<AppDeps, "publicUrl" | "viewerUrl" | "contentUrl" | "contentWildcard">;

export function urlsFromEnv(): Urls {
  const publicUrl = stripTrailingSlash(process.env.PUBLIC_URL ?? "http://localhost:8787");
  return {
    publicUrl,
    viewerUrl: stripTrailingSlash(process.env.VIEWER_URL ?? "http://localhost:5173"),
    contentUrl: stripTrailingSlash(process.env.CONTENT_URL ?? publicUrl),
    contentWildcard: process.env.CONTENT_WILDCARD === "true",
  };
}

export function limitsFromEnv(): UploadLimits {
  return {
    maxFileBytes: intEnv("COLLAB_MAX_FILE_BYTES"),
    maxSiteBytes: intEnv("COLLAB_MAX_SITE_BYTES"),
    maxFileCount: intEnv("COLLAB_MAX_FILE_COUNT"),
  };
}

// `githubFromEnv` lives in ./github-config.js (it also exports `botLoginFor` +
// `loadMirrorProviders`, which stay grouped with it); re-exported here so every
// M11 builder is reachable from one module.
export { githubFromEnv, type GitHubOperatorConfig } from "./github-config.js";

export type MirrorDeps = Pick<AppDeps, "mirror" | "mirrorBus">;

// The bus needs the db + store to resolve Page source bytes on dispatch; wire
// it here so the routes just call `deps.mirrorBus.emit`. No providers → noop bus.
export function mirrorFromEnv(opts: {
  db: Db;
  store: BlobStore;
  github: GitHubOperatorConfig | null;
}): MirrorDeps {
  const mirror = loadMirrorProviders({ github: opts.github, deps: { db: opts.db } });
  const mirrorBus = createMirrorBus({
    providers: mirror,
    db: opts.db,
    contextFor: () => buildMirrorContext({ db: opts.db, store: opts.store }),
  });
  return { mirror, mirrorBus };
}

// Build the rate limiter from env. Default: 20 comment-creates per 60s per
// identity. `COLLAB_RATELIMIT_DISABLED=true` turns it off; the count and window
// are overridable. `COLLAB_RATELIMIT_STORE=postgres` selects the multi-instance-
// safe implementation (default `memory`; no platform auto-detection here — a
// platform adapter may choose a default for itself, e.g. the Vercel adapter
// defaults to postgres, but config.ts never branches on the platform).
export function rateLimiterFromEnv(db: Db): RateLimiter {
  if (process.env.COLLAB_RATELIMIT_DISABLED === "true") return new NoopRateLimiter();
  const limit = intEnv("COLLAB_RATELIMIT_COMMENTS") ?? 20;
  const windowMs = intEnv("COLLAB_RATELIMIT_WINDOW_MS") ?? 60_000;
  if (process.env.COLLAB_RATELIMIT_STORE === "postgres") {
    return new PostgresRateLimiter(db, limit, windowMs);
  }
  return new FixedWindowRateLimiter(limit, windowMs);
}

export function internalSecretFromEnv(): string | null {
  return process.env.COLLAB_INTERNAL_SECRET?.trim() || null;
}

// Build deps from environment. Called lazily on first use so importing the app
// (e.g. for the health check in tests) never requires DATABASE_URL or S3.
export function depsFromEnv(): AppDeps {
  const db = dbFromEnv();
  const store = storeFromEnv();
  const urls = urlsFromEnv();
  const limits = limitsFromEnv();
  const github = githubFromEnv();
  const { mirror, mirrorBus } = mirrorFromEnv({ db, store, github });
  return {
    db,
    store,
    ...urls,
    rateLimiter: rateLimiterFromEnv(db),
    limits,
    mirror,
    mirrorBus,
    github,
    internalSecret: internalSecretFromEnv(),
  };
}

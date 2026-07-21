import { Hono } from "hono";
import { cors } from "hono/cors";
import { openAPIRouteHandler } from "hono-openapi";
import { depsFromEnv, type AppDeps } from "./config.js";
import { FixedWindowRateLimiter } from "./rate-limit.js";
import { sitesRoutes } from "./routes/sites.js";
import { contentRoutes } from "./routes/content.js";
import { blobsRoutes } from "./routes/blobs.js";
import { versionsRoutes } from "./routes/versions.js";
import { conversationsRoutes } from "./routes/conversations.js";
import { agentDocsRoutes } from "./routes/agent-docs.js";
import { webhooksRoutes } from "./routes/webhooks.js";
import { githubInstallRoutes } from "./routes/github-install.js";
import { noopMirrorBus } from "./mirror/bus.js";
import { startReconcilePoller } from "./mirror/reconcile.js";

// The hosted REST API + content-origin server (ADR-0011). M2 adds the first
// hosted tracer bullet: create a Site (`POST /sites`), read its metadata
// (`GET /sites/:slug`), and serve the Page on the content origin
// (`GET /content/sites/:slug`). Deps are injectable for tests; in production
// they are resolved from the environment on first use.
// Deps as a caller (test or embedder) may pass them: the content-origin fields
// are optional and default to path-based serving on the app origin; the M9
// rate limiter + upload limits are optional too (a caller that omits them gets a
// real limiter with default settings and no upload caps — infinite retention).
export type InputDeps = Omit<
  AppDeps,
  | "contentUrl"
  | "contentWildcard"
  | "rateLimiter"
  | "limits"
  | "mirror"
  | "mirrorBus"
  | "github"
> &
  Partial<
    Pick<
      AppDeps,
      | "contentUrl"
      | "contentWildcard"
      | "rateLimiter"
      | "limits"
      | "mirror"
      | "mirrorBus"
      | "github"
    >
  >;

function withContentDefaults(deps: InputDeps): AppDeps {
  const github = deps.github ?? null;
  const mirror = deps.mirror ?? (github ? [] : []);
  return {
    ...deps,
    contentUrl: deps.contentUrl ?? deps.publicUrl,
    contentWildcard: deps.contentWildcard ?? false,
    rateLimiter: deps.rateLimiter ?? new FixedWindowRateLimiter(20, 60_000),
    limits: deps.limits ?? {},
    github,
    mirror,
    mirrorBus: deps.mirrorBus ?? noopMirrorBus,
  };
}

export function createApp(deps?: InputDeps) {
  const app = new Hono();
  let cached: AppDeps | undefined = deps ? withContentDefaults(deps) : undefined;
  const getDeps = (): AppDeps => (cached ??= depsFromEnv());

  // The viewer SPA is a separate origin; allow it to read the API.
  app.use("*", cors());

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      service: "collab-server",
      time: new Date().toISOString(),
    }),
  );

  app.route("/", sitesRoutes(getDeps));
  app.route("/", versionsRoutes(getDeps));
  app.route("/", contentRoutes(getDeps));
  app.route("/", blobsRoutes(getDeps));
  app.route("/", conversationsRoutes(getDeps));
  app.route("/", agentDocsRoutes());
  app.route("/", webhooksRoutes(getDeps));
  app.route("/", githubInstallRoutes(getDeps));

  // Serve the OpenAPI 3.1 spec (ADR-0014) at /openapi.json. Generated from
  // describeRoute annotations on the routes above.
  app.get(
    "/openapi.json",
    openAPIRouteHandler(app, {
      documentation: {
        info: { title: "Collab API", version: "2.0.0" },
        openapi: "3.1.0",
      },
    }),
  );

  // Expose start hooks for the boot path:
  // - startMirror: drain the outbound mirror queue on startup (M10). No-op when
  //   no providers are registered.
  // - startReconcile: start the inbound reconciliation poller (M10). No-op when
  //   no providers or GitHub config is present.
  return Object.assign(app, {
    startMirror: () => getDeps().mirrorBus.start(),
    startReconcile: () => {
      const deps = getDeps();
      if (deps.mirror.length === 0 || !deps.github) return () => {};
      return startReconcilePoller(deps, deps.github.reconcileIntervalMs);
    },
  });
}

export type App = ReturnType<typeof createApp>;

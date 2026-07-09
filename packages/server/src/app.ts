import { Hono } from "hono";
import { cors } from "hono/cors";
import { depsFromEnv, type AppDeps } from "./config.js";
import { FixedWindowRateLimiter } from "./rate-limit.js";
import { sitesRoutes } from "./routes/sites.js";
import { contentRoutes } from "./routes/content.js";
import { blobsRoutes } from "./routes/blobs.js";
import { conversationsRoutes } from "./routes/conversations.js";
import { versionsRoutes } from "./routes/versions.js";
import { agentDocsRoutes } from "./routes/agent-docs.js";

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
  "contentUrl" | "contentWildcard" | "rateLimiter" | "limits"
> &
  Partial<Pick<AppDeps, "contentUrl" | "contentWildcard" | "rateLimiter" | "limits">>;

function withContentDefaults(deps: InputDeps): AppDeps {
  return {
    ...deps,
    contentUrl: deps.contentUrl ?? deps.publicUrl,
    contentWildcard: deps.contentWildcard ?? false,
    rateLimiter: deps.rateLimiter ?? new FixedWindowRateLimiter(20, 60_000),
    limits: deps.limits ?? {},
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

  return app;
}

export type App = ReturnType<typeof createApp>;

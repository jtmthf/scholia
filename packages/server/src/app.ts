import { Hono } from "hono";
import { cors } from "hono/cors";
import { depsFromEnv, type AppDeps } from "./config.js";
import { sitesRoutes } from "./routes/sites.js";
import { contentRoutes } from "./routes/content.js";

// The hosted REST API + content-origin server (ADR-0011). M2 adds the first
// hosted tracer bullet: create a Site (`POST /sites`), read its metadata
// (`GET /sites/:slug`), and serve the Page on the content origin
// (`GET /content/sites/:slug`). Deps are injectable for tests; in production
// they are resolved from the environment on first use.
export function createApp(deps?: AppDeps) {
  const app = new Hono();
  let cached: AppDeps | undefined = deps;
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
  app.route("/", contentRoutes(getDeps));

  return app;
}

export type App = ReturnType<typeof createApp>;

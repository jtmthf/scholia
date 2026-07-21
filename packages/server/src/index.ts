import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

export { createApp, type App, type InputDeps } from "./app.js";
export { type AppDeps, type UploadLimits } from "./config.js";
export {
  FixedWindowRateLimiter,
  NoopRateLimiter,
  type RateLimiter,
  type RateLimitResult,
} from "./rate-limit.js";

// Boot only when run directly (not when imported, e.g. by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8787);
  const app = createApp();
  // Start the outbound mirror bus (drains pending comment_mirrors rows on boot so
  // a crash/restart replays the queue). No-op when no providers are registered.
  void app.startMirror();
  // Start the inbound reconciliation poller — the fallback for firewalled
  // self-hosts and dropped webhook deliveries. No-op without GitHub config.
  app.startReconcile();
  serve({ fetch: app.fetch, port });
  console.log(`[collab] server listening on http://localhost:${port}`);
}

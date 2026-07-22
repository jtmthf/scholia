// POST/GET /internal/drain — the platform-agnostic trigger for the outbound
// mirror-bus drain + inbound reconcile sweep (M11, ADR-0015). Bearer-auth'd via
// `COLLAB_INTERNAL_SECRET`; disabled (404) when unset, matching the GitHub
// webhook route's disabled-when-unconfigured pattern. Self-host keeps calling
// `runMirrorDrain` from the existing boot-time `setInterval` (`startDrainLoop`)
// — this route exists for platforms with no persistent process (Vercel Cron
// only triggers via GET, so both methods are accepted here).
import { Hono, type Context } from "hono";
import { timingSafeEqual } from "node:crypto";
import type { AppDeps } from "../config.js";
import { runMirrorDrain } from "../mirror/reconcile.js";

export function internalRoutes(getDeps: () => AppDeps) {
  const app = new Hono();

  app.get("/internal/drain", (c) => drain(c, getDeps));
  app.post("/internal/drain", (c) => drain(c, getDeps));

  return app;
}

async function drain(c: Context, getDeps: () => AppDeps) {
  const deps = getDeps();
  if (!deps.internalSecret) {
    return c.json({ error: "internal drain not configured" }, 404);
  }

  const [scheme, token] = (c.req.header("Authorization") ?? "").split(" ");
  if (scheme !== "Bearer" || !token || !safeEqual(token, deps.internalSecret)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const result = await runMirrorDrain(deps);
  return c.json(result, 200);
}

// Constant-time compare so the secret can't be brute-forced via response timing.
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

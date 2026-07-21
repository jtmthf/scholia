// POST /webhooks/github — the inbound GitHub webhook endpoint (ADR-0008).
// Verifies the HMAC-SHA256 signature on the raw body, parses the payload into
// normalized InboundEvents. Comment/review events go to the importer; lifecycle
// events (synchronize/closed/locked) go to the lifecycle handler. Disabled (404)
// when no GITHUB_WEBHOOK_SECRET is configured so a misconfigured prod doesn't
// accidentally accept unsigned payloads.

import { Hono } from "hono";
import { verifySignature, parseWebhook, WebhookSignatureError } from "@collab/github";
import { importInbound } from "../mirror/importer.js";
import { handleLifecycle } from "../mirror/lifecycle.js";
import { botLoginFor } from "../github-config.js";
import type { AppDeps } from "../config.js";

export function webhooksRoutes(getDeps: () => AppDeps) {
  const app = new Hono();

  app.post("/webhooks/github", async (c) => {
    const deps = getDeps();

    // Disabled when no webhook secret is configured.
    if (!deps.github?.webhookSecret) {
      return c.json({ error: "GitHub webhooks not configured" }, 404);
    }

    // Read the raw body for HMAC verification (not parsed JSON).
    const rawBody = await c.req.text();

    // Verify the signature — constant-time compare, rejects missing/invalid.
    const sigHeader = c.req.header("X-Hub-Signature-256");
    try {
      verifySignature(rawBody, sigHeader, deps.github.webhookSecret);
    } catch (err) {
      if (err instanceof WebhookSignatureError) {
        return c.json({ error: err.message }, 401);
      }
      throw err;
    }

    // Parse the JSON payload (after signature verification).
    const eventName = c.req.header("X-GitHub-Event") ?? "";
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const events = parseWebhook(eventName, payload);
    if (events.length === 0) {
      return c.json({ accepted: 0 }, 200);
    }

    // Route events: lifecycle goes to handleLifecycle; the rest to importInbound.
    let accepted = 0;
    for (const event of events) {
      if (event.kind === "lifecycle") {
        await handleLifecycle(event, deps, deps.mirror.find((p) => p.id === "github"));
      } else {
        accepted += await importInbound([event], {
          db: deps.db,
          store: deps.store,
          botLogin: botLoginFor(deps.github),
        });
      }
    }
    return c.json({ accepted }, 200);
  });

  return app;
}
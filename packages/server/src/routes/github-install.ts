// GitHub App install flow (ADR-0009). The Owner opens `GET /github/install`,
// which redirects to the GitHub App install page. After the Owner installs the
// App on a repo, GitHub redirects to `GET /github/install/callback` with
// `?installation_id=...`. The callback stores the installation and renders a
// JS page that updates the parent window (if opened in a popup) with the result
// and closes itself. A simple CSRF state guards the callback via a signed cookie.
//
// Both routes are available only when `GITHUB_APP_ID` + `GITHUB_APP_SLUG` are
// configured — otherwise they 404 (GitHub integration is opt-in).

import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createHmac, randomBytes } from "node:crypto";
import { upsertGitHubInstallation } from "@scholia/db";
import type { AppDeps } from "../config.js";

const CSRF_COOKIE = "scholia_gh_state";
const CSRF_TTL = 15 * 60; // 15 minutes

function signState(state: string, secret: string): string {
  const mac = createHmac("sha256", secret).update(state).digest("hex");
  return `${state}.${mac}`;
}

function verifyState(signed: string, secret: string): string | null {
  const idx = signed.lastIndexOf(".");
  if (idx < 0) return null;
  const state = signed.slice(0, idx);
  const mac = signed.slice(idx + 1);
  const expected = createHmac("sha256", secret).update(state).digest("hex");
  // constant-time string comparison
  if (expected.length !== mac.length) return null;
  let ok = 0;
  for (let i = 0; i < expected.length; i++) ok |= expected.charCodeAt(i) ^ mac.charCodeAt(i);
  return ok === 0 ? state : null;
}

export function githubInstallRoutes(getDeps: () => AppDeps) {
  const app = new Hono();

  // Redirect to the GitHub App install page.
  // Only available when GitHub is configured.
  app.get("/github/install", (c) => {
    const deps = getDeps();
    const gh = deps.github;
    if (!gh?.appSlug) return c.json({ error: "GitHub integration not configured" }, 404);

    // Generate a CSRF state + sign it with the webhook secret.
    const state = randomBytes(16).toString("hex");
    const signed = signState(state, gh.webhookSecret || "fallback-secret");
    setCookie(c, CSRF_COOKIE, signed, {
      httpOnly: true,
      sameSite: "Lax",
      secure: true,
      path: "/",
      maxAge: CSRF_TTL,
    });

    return c.redirect(
      `https://github.com/apps/${encodeURIComponent(gh.appSlug)}/installations/new?state=${state}`,
    );
  });

  // Handle the callback from GitHub after installation.
  app.get("/github/install/callback", async (c) => {
    const deps = getDeps();
    const gh = deps.github;
    if (!gh) return c.json({ error: "GitHub integration not configured" }, 404);

    // Verify CSRF state.
    const cookie = getCookie(c, CSRF_COOKIE);
    const stateParam = c.req.query("state") ?? "";
    if (!cookie || !stateParam) {
      return c.html("<h1>Invalid request</h1><p>Missing CSRF state. Please try again.</p>", 400);
    }
    const verified = verifyState(cookie, gh.webhookSecret || "fallback-secret");
    if (verified !== stateParam) {
      return c.html(
        "<h1>CSRF check failed</h1><p>The state parameter does not match. Please try again.</p>",
        400,
      );
    }
    deleteCookie(c, CSRF_COOKIE, { path: "/" });

    // Read the installation id from the query string.
    const installId = Number(c.req.query("installation_id"));
    if (!Number.isInteger(installId) || installId < 1) {
      return c.html("<h1>Missing installation</h1><p>No installation_id received.</p>", 400);
    }

    // Store the installation. The callback doesn't include repo list, so we
    // store a minimal record. The repo list is refreshed when a Site is created
    // via `--pr` (the provider resolves repos from the installation).
    await upsertGitHubInstallation(deps.db, {
      installationId: installId,
    });

    // Render a page that signals the parent window (if any) and closes.
    const successHtml = `<!doctype html>
<html><head><title>Installation complete</title><style>
  body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .box { text-align: center; padding: 2rem; }
  h1 { color: #1a7f37; }
</style></head><body>
<div class="box">
  <h1>GitHub App installed</h1>
  <p>The Scholia GitHub App was installed successfully.</p>
  <p>You can now create PR-backed Sites with <code>scholia share --pr owner/repo#123</code>.</p>
</div>
<script>
  if (window.opener) {
    window.opener.postMessage({ scholiaGhInstalled: true, installationId: ${installId} }, "*");
    window.close();
  }
</script>
</body></html>`;
    return c.html(successHtml, 200);
  });

  return app;
}
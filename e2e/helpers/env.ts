import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The suite is environment-agnostic: it points at whatever API + viewer URLs you
// give it and never assumes a particular host. Defaults target a local stack;
// override to run against staging (SCHOLIA_API_URL=https://api.staging... etc).
function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** REST API + content origin (where `scholia share` uploads, where the viewer reads). */
export const API_URL = stripSlash(process.env.SCHOLIA_API_URL ?? "http://localhost:8787");

/** The viewer SPA — Playwright's baseURL and where Share URLs resolve. */
export const WEB_URL = stripSlash(process.env.SCHOLIA_WEB_URL ?? "http://localhost:5173");

function isLocal(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}

// Only manage local dev servers when both targets are local and the caller
// hasn't opted out. Against a remote/staging stack we boot nothing.
export const MANAGE_SERVERS =
  process.env.SCHOLIA_E2E_NO_WEBSERVER !== "1" && isLocal(API_URL) && isLocal(WEB_URL);

const HERE = dirname(fileURLToPath(import.meta.url));

/** Monorepo root — webServer commands and the CLI subprocess run from here. */
export const REPO_ROOT = join(HERE, "..", "..");

/** Test fixtures (sample Sites to share). */
export const FIXTURES = join(HERE, "..", "fixtures");
export const FIXTURE_SITE = join(FIXTURES, "site");
/** An HTML-Page Site (M4): index.html entry + a Markdown Page it links to. */
export const FIXTURE_HTML_SITE = join(FIXTURES, "html-site");

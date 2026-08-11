import { defineConfig, devices } from "@playwright/test";
import { API_URL, MANAGE_SERVERS, REPO_ROOT, WEB_URL } from "./helpers/env.js";

// End-to-end suite for the M3 vertical slice: `scholia share` -> blob negotiation
// -> server -> content origin -> sandboxed viewer. Environment-agnostic — point
// SCHOLIA_API_URL / SCHOLIA_WEB_URL at any stack (local default or staging). When
// both targets are local, Playwright boots the dev server + viewer for you and
// reuses them if already running.
const CI = !!process.env.CI;
// The HTML report is always emitted (local `open: "never"` so it never steals
// focus); CI additionally streams `github` annotations to the run log.
const HTML_REPORT: ["html", { open: "never" }] = ["html", { open: "never" }];

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // Every `runShare` call now runs `scholia share` through `turbo run scholia`
  // (dependsOn: ["^build"]), which forks its own child processes to verify/
  // rebuild @scholia/local — real CPU load per test that didn't exist before
  // universal dist exports. Stacked on Playwright's own worker + browser
  // processes and `startLocalPreview`'s direct `tsx` spawn (local-preview.ts),
  // the GitHub Actions runner's default worker count forks enough concurrent
  // processes to starve it: `spawn .../node_modules/.bin/tsx ENOENT` even
  // though nothing ever removes that binary, and even across a retry. One
  // worker in CI removes the contention rather than papering over it.
  workers: CI ? 1 : undefined,
  reporter: CI ? [["github"], HTML_REPORT] : [["list"], HTML_REPORT],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: WEB_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: MANAGE_SERVERS
    ? [
        {
          // `start` (no watch) in CI — bounded runtime and no file-watcher churn;
          // `dev` locally for the hot-reload loop.
          command: CI ? "pnpm --filter @scholia/server start" : "pnpm --filter @scholia/server dev",
          url: `${API_URL}/health`,
          cwd: REPO_ROOT,
          reuseExistingServer: true,
          timeout: 120_000,
        },
        {
          // The viewer SSRs its shell now (ADR-0011), so every other path is either
          // a Site URL or an honest 404 — `/health` is what returns a 200 to wait on.
          command: "pnpm --filter @scholia/web dev",
          url: `${WEB_URL}/health`,
          cwd: REPO_ROOT,
          reuseExistingServer: true,
          timeout: 120_000,
        },
      ]
    : undefined,
});

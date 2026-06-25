import { defineConfig, devices } from "@playwright/test";
import { API_URL, MANAGE_SERVERS, REPO_ROOT, WEB_URL } from "./helpers/env.js";

// End-to-end suite for the M3 vertical slice: `collab share` -> blob negotiation
// -> server -> content origin -> sandboxed viewer. Environment-agnostic — point
// COLLAB_API_URL / COLLAB_WEB_URL at any stack (local default or staging). When
// both targets are local, Playwright boots the dev server + viewer for you and
// reuses them if already running.
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : [["list"], ["html", { open: "never" }]],
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
          command: "pnpm --filter @collab/server dev",
          url: `${API_URL}/health`,
          cwd: REPO_ROOT,
          reuseExistingServer: true,
          timeout: 120_000,
        },
        {
          command: "pnpm --filter @collab/web dev",
          url: WEB_URL,
          cwd: REPO_ROOT,
          reuseExistingServer: true,
          timeout: 120_000,
        },
      ]
    : undefined,
});

import { defineConfig } from "vitest/config";

// Local, all-packages-at-once entry point (`pnpm test:projects`). Each
// packages/* directory with its own vitest.config.ts is discovered as an
// independent project using that file's own settings — including, for
// @scholia/db and @scholia/server, the Postgres globalSetup. CI instead runs
// `turbo run test`, which invokes each package's `vitest run` individually
// so results are cached per package (see packages/*/vitest.config.ts and
// @scholia/vitest-config for the settings shared across both entry points).
export default defineConfig({
  test: {
    projects: ["packages/*"],
  },
});

import { defineConfig } from "vitest/config";
import { sharedConfig } from "@scholia/vitest-config";

export default defineConfig({
  ...sharedConfig,
  test: {
    ...sharedConfig.test,
    name: "server",
    // @scholia/db owns the isolated-Postgres-per-run setup; server's tests
    // need the same database it does.
    globalSetup: ["@scholia/db/test/setup.js"],
  },
});

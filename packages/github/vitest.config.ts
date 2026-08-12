import { defineConfig } from "vitest/config";
import { sharedConfig } from "@scholia/vitest-config";

export default defineConfig({
  ...sharedConfig,
  test: { ...sharedConfig.test, name: "github" },
});

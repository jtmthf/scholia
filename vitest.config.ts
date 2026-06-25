import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Everything runs in Node — no DOM. Browser client code (packages/local
    // src/client) is built by tsup and intentionally out of scope here.
    environment: "node",
    include: ["packages/*/test/**/*.test.ts"],
    // The real render pipeline (Shiki/KaTeX) and server boot are not free;
    // give integration tests room before they're flagged as hung.
    testTimeout: 20000,
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Everything runs in Node — no DOM. Browser client code (packages/local
    // src/client) is built by tsup and intentionally out of scope here.
    // Preact components are still in scope: they're asserted through
    // preact-render-to-string, the same way the Local Preview chrome is.
    environment: "node",
    include: ["packages/*/test/**/*.test.{ts,tsx}"],
    // Create a fresh Postgres database per test run, migrate it, and point
    // DATABASE_URL at it. Fails loudly if DATABASE_URL is unset. Teardown
    // drops the isolated database.
    globalSetup: ["packages/db/test/setup.ts"],
    // Inlined so the react → preact/compat alias below applies to it: aliases don't
    // reach externalized deps, and an externalized react-query pulls in real React
    // (mirrors `ssr.noExternal` in packages/web/vite.config.ts).
    server: { deps: { inline: ["@tanstack/react-query"] } },
    // The real render pipeline (Shiki/KaTeX) and server boot are not free;
    // give integration tests room before they're flagged as hung.
    testTimeout: 20000,
  },
  // Preact JSX for the .tsx tests, matching tsconfig.base.json.
  // Vite 8 replaces esbuild with Oxc (oxc config, same shape).
  oxc: { jsx: "automatic", jsxImportSource: "preact" },
  // TanStack Query is a React package; @scholia/web renders it on Preact via
  // preact/compat, and its SSR entry is tested here, so the alias has to hold in
  // Vitest too (it mirrors packages/web/vite.config.ts).
  resolve: {
    alias: {
      react: "preact/compat",
      "react-dom": "preact/compat",
      "react-dom/test-utils": "preact/test-utils",
      "react/jsx-runtime": "preact/jsx-runtime",
    },
  },
});

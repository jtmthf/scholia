import { defineConfig, defineProject } from "vitest/config";

// Shared Vitest settings for every Scholia project. Everything runs in Node — no
// DOM. Browser client code (packages/local/src/client) is built by tsup and is
// intentionally out of scope here. Preact components are asserted through
// preact-render-to-string, the same way the Local Preview chrome is.
const shared = {
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
  test: {
    environment: "node",
    // Inlined so the react → preact/compat alias above applies to it: aliases don't
    // reach externalized deps, and an externalized react-query pulls in real React
    // (mirrors `ssr.noExternal` in packages/web/vite.config.ts).
    server: { deps: { inline: ["@tanstack/react-query"] } },
    // The real render pipeline (Shiki/KaTeX) and server boot are not free;
    // give integration tests room before they're flagged as hung.
    testTimeout: 20000,
  },
} as const;

export default defineConfig({
  ...shared,
  test: {
    ...shared.test,
    projects: [
      // Pure packages whose tests never touch Postgres. Run with
      // `vitest run --project no-db` (or `pnpm test:no-db`) on CI runners that
      // have no database available.
      defineProject({
        extends: true,
        test: {
          name: "no-db",
          include: [
            "packages/core/test/**/*.test.{ts,tsx}",
            "packages/cli/test/**/*.test.{ts,tsx}",
            "packages/local/test/**/*.test.{ts,tsx}",
            "packages/sidecar/test/**/*.test.{ts,tsx}",
            "packages/ui/test/**/*.test.{ts,tsx}",
            "packages/bridge/test/**/*.test.{ts,tsx}",
            "packages/github/test/**/*.test.{ts,tsx}",
            "packages/web/test/**/*.test.{ts,tsx}",
          ],
        },
      }),
      // Hosted-path packages that need a Postgres database. The global setup
      // creates a fresh isolated database per run, migrates it, and points
      // DATABASE_URL at it.
      defineProject({
        extends: true,
        test: {
          name: "db",
          include: [
            "packages/db/test/**/*.test.{ts,tsx}",
            "packages/server/test/**/*.test.{ts,tsx}",
          ],
          globalSetup: ["packages/db/test/setup.ts"],
        },
      }),
    ],
  },
});

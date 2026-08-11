import type { TestUserConfig, ViteUserConfig } from "vitest/config";

// `defineConfig`'s own parameter type is a union that includes the
// function/Promise overloads (config-as-a-function forms), which oxlint's
// no-misused-spread/no-misused-promises correctly object to wherever a
// consumer spreads this — every package's own vitest.config.ts. This is the
// plain-object shape alone.
type SharedConfig = ViteUserConfig & { test?: TestUserConfig };

// Shared Vitest settings for every Scholia project. Everything runs in Node —
// no DOM. Browser client code (packages/local/src/client) is built by tsup and
// is intentionally out of scope here. Preact components are asserted through
// preact-render-to-string, the same way the Local Preview chrome is.
export const sharedConfig: SharedConfig = {
  // Preact JSX for the .tsx tests, matching @scholia/tsconfig/base.json.
  // Vite 8 replaces esbuild with Oxc (oxc config, same shape).
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  // TanStack Query is a React package; @scholia/web renders it on Preact via
  // preact/compat, and its SSR entry is tested here, so the alias has to hold
  // in Vitest too (it mirrors packages/web/vite.config.ts).
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
    // Inlined so the react → preact/compat alias above applies to it: aliases
    // don't reach externalized deps, and an externalized react-query pulls in
    // real React (mirrors `ssr.noExternal` in packages/web/vite.config.ts).
    server: { deps: { inline: ["@tanstack/react-query"] } },
    // The real render pipeline (Shiki/KaTeX) and server boot are not free;
    // give integration tests room before they're flagged as hung.
    testTimeout: 20000,
  },
};

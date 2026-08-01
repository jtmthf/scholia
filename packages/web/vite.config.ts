import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import devServer from "@hono/vite-dev-server";

// The hosted Viewer (ADR-0011): Preact + Vite + TanStack Query + a small router,
// SSR'd by a Hono route and hydrated on the client. It reads the API over CORS
// (VITE_API_URL, default the local server) and embeds Page content from the content
// origin in a sandboxed iframe.
//
// Both halves are built by Vite — client with `vite build`, server with `vite build
// --ssr` — because the `react` alias below has to hold for the server bundle too:
// TanStack Query is a React package running on Preact.
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [
    preact(),
    devServer({
      entry: "src/dev.ts",
      // Only Vite's own module graph is withheld from the Hono app. The plugin's
      // default list also excludes anything ending in `.md`/`.ts`/`.js`, which would
      // swallow real viewer URLs — `/s/<slug>/guide/intro.md` is a Page, not a file.
      exclude: [/^\/@.+$/, /^\/src\/.+$/, /^\/node_modules\/.*/, /^\/\.vite\/.*/, /\?t=\d+$/],
    }),
  ],
  resolve: {
    alias: {
      react: "preact/compat",
      "react-dom": "preact/compat",
      "react-dom/test-utils": "preact/test-utils",
      "react/jsx-runtime": "preact/jsx-runtime",
    },
  },
  // Aliases don't reach dependencies Vite externalizes, and an externalized
  // react-query would resolve the real React at runtime on the server. Bundling it
  // into the SSR output is what makes the alias above apply to both halves.
  ssr: { noExternal: ["@tanstack/react-query"] },
  // The SSR entry is named on the command line (`--ssr src/node.ts`), because the
  // CLI flag overrides `build.ssr` from here and would leave the input unset.
  build: isSsrBuild
    ? // A Node bundle, so it gets Node's target rather than the browser baseline.
      { outDir: "dist/server", emptyOutDir: true, target: "node22" }
    : // The manifest is how the server learns the hashed asset names to emit.
      { outDir: "dist/client", manifest: true, rolldownOptions: { input: "src/entry-client.tsx" } },
  server: { port: 5173 },
}));

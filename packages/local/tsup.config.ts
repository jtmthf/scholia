import { defineConfig } from "tsup";

export default defineConfig([
  // The Node server entry (startServer et al.), consumed by @scholia/cli
  // and run from source via tsx for local dev.
  {
    entry: ["src/index.ts"],
    outDir: "dist",
    format: ["esm"],
    platform: "node",
    target: "node22",
    dts: false,
    sourcemap: true,
    // false: the sibling `typecheck` script emits dist/*.d.ts into this same
    // outDir, and clean:true would wipe it regardless of run order.
    clean: false,
    esbuildOptions(options) {
      options.jsx = "automatic";
      options.jsxImportSource = "preact";
    },
  },
  // Builds the browser client bundle that the Local Preview server serves at
  // /__assets/.
  //
  // Emits dist/assets/client.js (+ client.css), and vendors KaTeX's
  // stylesheet and fonts into dist/assets/katex so math renders offline.
  {
    entry: { client: "src/client/main.ts" },
    outDir: "dist/assets",
    format: ["esm"],
    platform: "browser",
    target: "es2022",
    // Split so the lazy `import("mermaid")` becomes its own on-demand chunk.
    splitting: true,
    clean: true,
    dts: false,
    minify: true,
    // mermaid and friends must be bundled, not externalized, for the browser.
    noExternal: [/.*/],
    // app.css imports @scholia/theme/type.css, which declares @font-face
    // rules with relative url("./fonts/*.woff2"); esbuild needs an explicit
    // loader to bundle those binaries (Vite does this natively, esbuild does
    // not).
    loader: { ".woff2": "file" },
    onSuccess: "node scripts/copy-assets.mjs",
  },
]);

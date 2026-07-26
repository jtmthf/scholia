import { defineConfig } from "tsup";

// Builds the browser client bundle that the Local Preview server serves at
// /__assets/. The Node server itself runs from source via tsx (the `scholia`
// CLI), so only the browser entry needs bundling here.
//
// Emits dist/assets/client.js (+ client.css), and vendors KaTeX's stylesheet
// and fonts into dist/assets/katex so math renders offline.
export default defineConfig({
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
  // app.css imports @scholia/theme/type.css, which declares @font-face rules
  // with relative url("./fonts/*.woff2"); esbuild needs an explicit loader
  // to bundle those binaries (Vite does this natively, esbuild does not).
  loader: { ".woff2": "file" },
  onSuccess: "node scripts/copy-assets.mjs",
});

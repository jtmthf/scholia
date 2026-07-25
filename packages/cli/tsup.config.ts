import { defineConfig } from "tsup";

// Bundles the `scholia` binary for publishing: cli.ts plus the workspace
// packages it depends on (@collab/core, @collab/local, @collab/client) are
// inlined into a single dist/cli.js, since those aren't published
// separately. Real npm dependencies (hono, chokidar, cac, open, ...) stay
// external — tsup/esbuild leaves node_modules resolution alone by default,
// so they're installed normally from the published package's own
// `dependencies`.
//
// The entry keeps its `#!/usr/bin/env node` shebang; tsup preserves it and
// chmods the output +x.
//
// dist/assets (the Local Preview browser bundle) is a separate build —
// `@collab/local`'s own tsup config — copied in by scripts/copy-assets.mjs
// after this bundle exists. server.ts resolves it via
// `new URL("../dist/assets/", import.meta.url)`, i.e. relative to wherever
// this file's own dist/ lives, so the copy target must be dist/assets here.
export default defineConfig({
  entry: { cli: "src/cli.ts" },
  outDir: "dist",
  format: ["esm"],
  platform: "node",
  target: "node22",
  noExternal: [/^@collab\//],
  clean: true,
  dts: false,
  // `import.meta.url`/`__dirname` polyfills (server.ts's ASSETS_DIR uses
  // `import.meta.url`) — this does NOT define `require`, see banner below.
  shims: true,
  // Several transitively-bundled CJS deps (confirmed so far: something in
  // the shiki/rehype chain calling plain `require('process')`) call bare
  // `require(...)` for Node builtins. esbuild's own shim for bundled
  // `require()` calls in ESM output falls back to `typeof require !==
  // "undefined"`, which is always false in real ESM (no `require` global)
  // — the module id being a string literal doesn't matter; the shim throws
  // `Dynamic require of "..." is not supported` regardless. `platform:
  // "node"` alone doesn't fix this; esbuild never auto-injects
  // `createRequire`. Doing it here makes that `typeof require` check true,
  // so esbuild's shim uses our real `require` instead of throwing.
  banner(ctx) {
    if (ctx.format !== "esm") return {};
    return {
      js: "import { createRequire as __collabCreateRequire } from 'node:module';\nconst require = __collabCreateRequire(import.meta.url);",
    };
  },
  // Published artifact, not a dev build — `pnpm start` runs from source via
  // tsx for local iteration, so this doesn't need sourcemaps.
  minify: true,
  sourcemap: false,
});

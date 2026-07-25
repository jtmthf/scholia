// Vendors the three variable-weight woff2 faces this package's type.css
// declares @font-face for, so Local Preview (and any other @collab/theme
// consumer) never fetches fonts over the network. Mirrors the pattern
// packages/local/scripts/copy-assets.mjs uses for KaTeX: resolve the
// installed npm package on disk, then copy the specific file(s) needed.
//
// Each @fontsource-variable/* package ships per-script subsets (latin,
// latin-ext, cyrillic, greek, vietnamese, ...) plus separate axis files
// (wght vs opsz vs "standard"). type.css only needs the latin, weight-axis,
// upright face for each family — matching the three @font-face
// declarations there — so only that one file per package is vendored here,
// not the full multi-script node_modules tree.
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fonts");

const FONTS = [
  {
    pkg: "@fontsource-variable/source-serif-4",
    src: "files/source-serif-4-latin-wght-normal.woff2",
    dest: "source-serif-4-variable.woff2",
  },
  {
    pkg: "@fontsource-variable/public-sans",
    src: "files/public-sans-latin-wght-normal.woff2",
    dest: "public-sans-variable.woff2",
  },
  {
    pkg: "@fontsource-variable/fira-code",
    src: "files/fira-code-latin-wght-normal.woff2",
    dest: "fira-code-variable.woff2",
  },
];

async function main() {
  await mkdir(outDir, { recursive: true });

  for (const { pkg, src, dest } of FONTS) {
    const pkgJsonPath = require.resolve(`${pkg}/package.json`);
    const srcPath = join(dirname(pkgJsonPath), src);
    await copyFile(srcPath, join(outDir, dest));
  }

  console.log(`[collab] vendored ${FONTS.length} fonts -> packages/theme/fonts`);
}

main().catch((err) => {
  console.error("[collab] copy-assets failed:", err);
  process.exit(1);
});

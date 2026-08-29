// Vendors KaTeX's stylesheet + fonts into dist/assets so Local Preview renders
// math offline, and copies this package's own static assets (the favicon)
// alongside them. Runs as tsup's onSuccess hook for the client build.
import { copyFile, cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

async function main() {
  const katexCssPath = require.resolve("katex/dist/katex.min.css");
  const katexDist = dirname(katexCssPath);

  const assetsDir = join(process.cwd(), "dist", "assets");
  const katexOutDir = join(assetsDir, "katex");
  await mkdir(katexOutDir, { recursive: true });

  // katex.min.css references ./fonts/* via relative URLs, so copy css + the fonts dir together.
  await cp(katexCssPath, join(katexOutDir, "katex.min.css"));
  await cp(join(katexDist, "fonts"), join(katexOutDir, "fonts"), { recursive: true });

  console.log("[scholia] vendored KaTeX assets -> dist/assets/katex");

  await copyFile(
    join(process.cwd(), "src", "assets", "favicon.svg"),
    join(assetsDir, "favicon.svg"),
  );

  console.log("[scholia] copied favicon -> dist/assets/favicon.svg");
}

main().catch((err) => {
  console.error("[scholia] copy-assets failed:", err);
  process.exit(1);
});

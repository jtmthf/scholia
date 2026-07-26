// Vendors KaTeX's stylesheet + fonts into dist/assets so Local Preview renders
// math offline. Runs as tsup's onSuccess hook for the client build.
import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

async function main() {
  const katexCssPath = require.resolve("katex/dist/katex.min.css");
  const katexDist = dirname(katexCssPath);

  const outDir = join(process.cwd(), "dist", "assets", "katex");
  await mkdir(outDir, { recursive: true });

  // katex.min.css references ./fonts/* via relative URLs, so copy css + the fonts dir together.
  await cp(katexCssPath, join(outDir, "katex.min.css"));
  await cp(join(katexDist, "fonts"), join(outDir, "fonts"), { recursive: true });

  console.log("[scholia] vendored KaTeX assets -> dist/assets/katex");
}

main().catch((err) => {
  console.error("[scholia] copy-assets failed:", err);
  process.exit(1);
});

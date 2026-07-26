// Copies @scholia/local's browser bundle (client JS/CSS + vendored KaTeX,
// built by that package's own tsup config) into this package's dist/assets,
// where the bundled server (see tsup.config.ts) expects to find it at
// runtime.
import { cp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "local", "dist", "assets");
const dest = join(here, "..", "dist", "assets");

await rm(dest, { recursive: true, force: true });
await cp(src, dest, { recursive: true });

console.log("[scholia] copied @scholia/local browser bundle -> dist/assets");

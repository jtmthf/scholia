// PROTOTYPE (issue #24) — THROWAWAY. Guards the one property the corpus must
// have: every fixture revision is the git blob, byte for byte. oxfmt formats
// markdown, so a `pnpm format` run could silently rewrite the corpus into
// something that is no longer a real agent rewrite.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readChains } from "./corpus.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const CHAINS = join(HERE, "..", "test", "fixtures", "anchor-migration", "chains");

let checked = 0;
let drifted = 0;

for (const chain of readChains()) {
  for (const rev of chain.revisions) {
    const onDisk = readFileSync(join(CHAINS, chain.slug, rev.file), "utf8");
    const inGit = execFileSync("git", ["show", `${rev.commit}:${chain.path}`], {
      cwd: REPO,
      maxBuffer: 64 * 1024 * 1024,
    }).toString();
    checked++;
    if (onDisk !== inGit) {
      drifted++;
      console.log(`DRIFTED  ${chain.slug}/${rev.file}  (${rev.commit}:${chain.path})`);
      console.log(`         on disk ${onDisk.length} bytes, git ${inGit.length} bytes`);
    }
  }
}

console.log(
  drifted === 0
    ? `\x1b[32mOK\x1b[0m  ${checked} revisions match their git blobs byte for byte`
    : `\x1b[31mFAIL\x1b[0m  ${drifted}/${checked} revisions drifted — re-run pnpm prototype:anchors:extract`,
);
process.exit(drifted === 0 ? 0 : 1);

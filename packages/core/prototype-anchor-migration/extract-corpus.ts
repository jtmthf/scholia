// PROTOTYPE (issue #24) — THROWAWAY.
//
// git history -> fixture document chains. This repo was built by agents, so
// consecutive distinct revisions of its own docs ARE real agent rewrites; that is
// the corpus. Writes one directory per document with v1..vN.md oldest-first, plus
// chains.json describing where each revision came from.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const OUT = join(HERE, "..", "test", "fixtures", "anchor-migration", "chains");

// The six most heavily agent-rewritten prose docs in the repo. Chosen for churn,
// not for outcome — they are the files agents actually edit.
const DOCS = [
  { slug: "context", path: "CONTEXT.md" },
  { slug: "agents", path: "AGENTS.md" },
  { slug: "readme", path: "README.md" },
  { slug: "contributing", path: "CONTRIBUTING.md" },
  { slug: "plan", path: "PLAN.md" },
  { slug: "launch", path: "LAUNCH.md" },
];

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: REPO, maxBuffer: 64 * 1024 * 1024 }).toString();
}

interface Revision {
  v: number;
  commit: string;
  date: string;
  subject: string;
  file: string;
  bytes: number;
}

interface Chain {
  slug: string;
  path: string;
  revisions: Revision[];
}

const chains: Chain[] = [];

rmSync(OUT, { recursive: true, force: true });

for (const doc of DOCS) {
  // Oldest-first commit list touching this path, across all refs.
  const commits = git(
    "log",
    "--all",
    "--reverse",
    "--format=%H%x09%ad%x09%s",
    "--date=short",
    "--",
    doc.path,
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [commit, date, ...rest] = line.split("\t");
      return { commit: commit!, date: date!, subject: rest.join("\t") };
    });

  const dir = join(OUT, doc.slug);
  mkdirSync(dir, { recursive: true });

  const revisions: Revision[] = [];
  let lastBlob = "";

  for (const c of commits) {
    let blob: string;
    let content: string;
    try {
      blob = git("rev-parse", `${c.commit}:${doc.path}`).trim();
      content = git("show", `${c.commit}:${doc.path}`);
    } catch {
      continue; // path absent in that commit
    }
    // Skip no-op revisions: a PR merge and its branch commit carry the same blob.
    if (blob === lastBlob) continue;
    lastBlob = blob;

    const v = revisions.length + 1;
    const file = `v${v}.md`;
    writeFileSync(join(dir, file), content);
    revisions.push({
      v,
      commit: c.commit.slice(0, 8),
      date: c.date,
      subject: c.subject,
      file,
      bytes: content.length,
    });
  }

  chains.push({ slug: doc.slug, path: doc.path, revisions });
  console.log(
    `${doc.slug.padEnd(13)} ${String(revisions.length).padStart(2)} revisions  (${doc.path})`,
  );
}

writeFileSync(join(OUT, "chains.json"), JSON.stringify({ chains }, null, 2) + "\n");
console.log(`\nwrote ${join(OUT, "chains.json")}`);

#!/usr/bin/env node
/**
 * PROTOTYPE — throwaway. Delete once issue #17 has an ADR.
 *
 * QUESTION THIS ANSWERS
 * ---------------------
 * Does a monorepo task runner earn its place in this 11-package workspace, now
 * that TypeScript 7's native compiler is GA — and if so, Turborepo or Vite+?
 *
 * "No tool yet" is a valid answer. The point of this harness is to make that
 * answer falsifiable: same workloads, same scenarios, same machine, real
 * numbers, per candidate. Precedent is ADR-0024, which settled oxlint vs Biome
 * the same way.
 *
 * HOW IT WORKS
 * ------------
 * Each candidate lives on its own throwaway branch. The harness itself is
 * identical on every branch — the per-candidate commands live in CANDIDATES
 * below, keyed by label, so no branch has to edit this file.
 *
 *   node scripts/prototype-task-runner-trial.mjs run <label>
 *   node scripts/prototype-task-runner-trial.mjs report
 *
 * Results are written OUTSIDE the repo (~/.cache/scholia-task-runner-trial) so
 * they survive the branch switching this trial requires.
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const RESULTS = join(homedir(), ".cache", "scholia-task-runner-trial");

const B = "\x1b[1m", D = "\x1b[2m", R = "\x1b[0m", G = "\x1b[32m", Y = "\x1b[33m", X = "\x1b[31m";

/** A leaf package every other package depends on — touched to simulate a real edit. */
const TOUCH_FILE = join(REPO, "packages/core/src/index.ts");

/**
 * Caches that must go for a run to count as cold. Deliberately includes every
 * candidate's cache, not just the one under test: a stale .turbo left behind
 * while measuring Vite+ would quietly flatter nobody, but it would confuse the
 * next reader of this directory.
 */
const COLD_PATHS = [
  "node_modules/.cache",
  "node_modules/.vite",
  ".turbo",
  ".turbo-cache",
  "packages/*/.turbo",
  "packages/*/dist",
  "packages/*/*.tsbuildinfo",
  "*.tsbuildinfo",
];

const CANDIDATES = {
  "baseline-ts5": {
    describe: "main as it stands — pnpm scripts, TypeScript 5.7, no task runner",
    typecheck: "pnpm typecheck",
    test: "pnpm test:ci",
    build: "pnpm -r build",
  },
  "baseline-ts7": {
    describe: "same pnpm scripts, TypeScript 7 native compiler",
    typecheck: "pnpm typecheck",
    test: "pnpm test:ci",
    build: "pnpm -r build",
  },
  turbo: {
    describe: "Turborepo orchestrating the existing scripts, TypeScript 7",
    // e2e is filtered out to match the baseline: `pnpm test:ci` excludes the
    // Playwright suite, which needs the whole stack up. Including it here would
    // compare a passing baseline against a failing candidate.
    // --cache-dir is pinned so the harness can actually clear it. Turbo's default
    // location resolved somewhere COLD_PATHS missed, which silently turned every
    // "cold" measurement into a warm one.
    typecheck: "pnpm turbo run typecheck --cache-dir=.turbo-cache",
    test: "pnpm turbo run test --filter=!@scholia/e2e --cache-dir=.turbo-cache",
    build: "pnpm turbo run build --cache-dir=.turbo-cache",
  },
  viteplus: {
    describe: "Vite+ `vp run` orchestrating the existing scripts, TypeScript 7",
    typecheck: "pnpm vp run -r typecheck",
    test: "pnpm vp run -r test",
    build: "pnpm vp run -r build",
  },
};

const WORKLOADS = ["typecheck", "test", "build"];

/**
 * cold  — every cache cleared. What CI pays on a fresh runner with no remote cache.
 * warm  — immediate re-run, nothing changed. The best case a cache can ever show.
 * inc   — one leaf file touched. The number that actually matters day to day,
 *         because it is the loop an agent runs dozens of times an hour.
 */
const SCENARIOS = ["cold", "warm", "inc"];
const REPEATS = { cold: 1, warm: 3, inc: 3 };

function sh(cmd, capture = true) {
  return spawnSync(cmd, {
    cwd: REPO,
    shell: true,
    stdio: capture ? "pipe" : "inherit",
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
  });
}

function clearCaches() {
  execSync(`rm -rf ${COLD_PATHS.join(" ")}`, { cwd: REPO, shell: "/bin/bash", stdio: "ignore" });
}

/**
 * Turborepo and Vite+ both fingerprint file *contents*, not mtime — an mtime-only
 * `touch` is a cache HIT for them and a full rebuild for the plain-pnpm baseline,
 * which would have compared a no-op against real work. So edit the bytes, with a
 * counter so no two edits hash alike, and restore the file afterwards.
 */
const ORIGINAL_LEAF = readFileSync(TOUCH_FILE, "utf8");
let edits = 0;

function editLeaf() {
  if (!existsSync(TOUCH_FILE)) throw new Error(`edit target missing: ${TOUCH_FILE}`);
  writeFileSync(TOUCH_FILE, `${ORIGINAL_LEAF}\n// trial edit ${++edits}\n`);
}

function restoreLeaf() {
  writeFileSync(TOUCH_FILE, ORIGINAL_LEAF);
}

/** Wall-clock ms for one invocation, plus whether it actually succeeded. */
function time(cmd) {
  const started = performance.now();
  const res = sh(cmd);
  const ms = performance.now() - started;
  return { ms, ok: res.status === 0, status: res.status, tail: (res.stderr || res.stdout || "").trim().slice(-600) };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const secs = (ms) => `${(ms / 1000).toFixed(2)}s`;

function runCandidate(label) {
  const cand = CANDIDATES[label];
  if (!cand) {
    console.error(`unknown label "${label}". known: ${Object.keys(CANDIDATES).join(", ")}`);
    process.exit(1);
  }

  console.log(`\n${B}${label}${R} ${D}— ${cand.describe}${R}\n`);
  const out = { label, describe: cand.describe, recordedAt: new Date().toISOString(), commands: {}, results: {} };

  for (const workload of WORKLOADS) {
    const cmd = cand[workload];
    out.commands[workload] = cmd;
    out.results[workload] = {};
    console.log(`${B}${workload}${R} ${D}${cmd}${R}`);

    for (const scenario of SCENARIOS) {
      const runs = [];
      let failure = null;

      for (let i = 0; i < REPEATS[scenario]; i++) {
        if (scenario === "cold") clearCaches();

        // A cold measurement is only cold once. Warm and inc need a populated
        // cache to be meaningful, so prime it before the first timed run.
        if (scenario !== "cold" && i === 0) {
          restoreLeaf();
          sh(cmd);
        }
        // Edit AFTER priming, so the timed run is the one facing a changed file.
        if (scenario === "inc") editLeaf();

        const { ms, ok, status, tail } = time(cmd);
        if (!ok && !failure) failure = { status, tail };
        runs.push(ms);
        process.stdout.write(`  ${D}${scenario} #${i + 1}${R} ${secs(ms)}${ok ? "" : ` ${X}(exit ${status})${R}`}\n`);
      }

      const m = median(runs);
      out.results[workload][scenario] = { runs, median: m, failure };
      console.log(`  ${scenario.padEnd(5)} ${B}${secs(m)}${R} ${D}median of ${runs.length}${R}${failure ? ` ${X}FAILED${R}` : ` ${G}ok${R}`}`);
    }
    console.log("");
  }

  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, `${label}.json`), JSON.stringify(out, null, 2));
  console.log(`${D}written to ${join(RESULTS, `${label}.json`)}${R}`);
  report();
}

function report() {
  if (!existsSync(RESULTS)) return console.log("no results recorded yet");
  const files = readdirSync(RESULTS).filter((f) => f.endsWith(".json"));
  if (!files.length) return console.log("no results recorded yet");

  const order = Object.keys(CANDIDATES);
  const data = files
    .map((f) => JSON.parse(readFileSync(join(RESULTS, f), "utf8")))
    .sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));

  console.log(`\n${B}Task runner trial — median wall clock${R}`);
  console.log(`${D}Apple M2, 8 cores. Lower is better. "inc" = one leaf file in @scholia/core touched.${R}\n`);

  const w = 16;
  for (const workload of WORKLOADS) {
    console.log(`${B}${workload}${R}`);
    console.log(`  ${"candidate".padEnd(w)}${SCENARIOS.map((s) => s.padStart(10)).join("")}`);
    for (const d of data) {
      const cells = SCENARIOS.map((s) => {
        const r = d.results[workload]?.[s];
        if (!r) return "—".padStart(10);
        return (r.failure ? `${X}${secs(r.median)}!${R}` : secs(r.median)).padStart(r.failure ? 19 : 10);
      }).join("");
      console.log(`  ${d.label.padEnd(w)}${cells}`);
    }
    console.log("");
  }

  const missing = order.filter((l) => !data.some((d) => d.label === l));
  if (missing.length) console.log(`${Y}not yet measured:${R} ${missing.join(", ")}\n`);
}

const [, , cmd, label] = process.argv;
if (cmd === "run") {
  // The leaf file is edited in place to force cache misses; never leave it dirty.
  process.on("exit", restoreLeaf);
  process.on("SIGINT", () => process.exit(130));
  try {
    runCandidate(label);
  } finally {
    restoreLeaf();
  }
}
else if (cmd === "report") report();
else {
  console.log(`${B}PROTOTYPE — task runner trial (issue #17)${R}

  node scripts/prototype-task-runner-trial.mjs run <label>
  node scripts/prototype-task-runner-trial.mjs report

${B}labels${R}
${Object.entries(CANDIDATES).map(([k, v]) => `  ${k.padEnd(16)}${D}${v.describe}${R}`).join("\n")}
`);
}

// PROTOTYPE (issue #24) — THROWAWAY. Non-interactive dump of the whole tally.
// `tsx packages/core/prototype-anchor-migration/report.ts`
import { loadChains, readCases, LAYERS, type Layer } from "./corpus.js";
import {
  measureCase,
  measureChainCase,
  measureRequoteDivergence,
  measureBornAmbiguous,
  measureDecoyExposure,
  tally,
  CHAIN_STRATEGIES,
  type Outcome,
} from "./measure.js";

const B = "\x1b[1m";
const D = "\x1b[2m";
const R = "\x1b[0m";
const RED = "\x1b[31m";
const GRNC = "\x1b[32m";

const chains = await loadChains();
const { cases, chainCases } = readCases();

console.log(`${B}Anchor migration accuracy — issue #24${R}`);
console.log(
  `${D}${cases.length} single-step cases, ${chainCases.length} chain cases, ${chains.size} document chains${R}\n`,
);

// ---------------------------------------------------------------- skips first
const skips: string[] = [];
for (const layer of LAYERS) {
  for (const c of cases) {
    const m = measureCase(c, chains, layer);
    if (m.skipped) skips.push(`  ${c.id} [${layer}] — ${m.skipped}`);
  }
  for (const c of chainCases) {
    const m = measureChainCase(c, chains, layer, CHAIN_STRATEGIES[0]!);
    if (m.skipped) skips.push(`  ${c.id} [${layer}] — ${m.skipped}`);
  }
}
if (skips.length) {
  console.log(`${B}Excluded (selection not uniquely locatable)${R}`);
  for (const s of skips) console.log(s);
  console.log();
}

function pct(n: number, total: number): string {
  return total === 0 ? "  — " : `${String(Math.round((n / total) * 100)).padStart(3)}%`;
}

function printTally(title: string, outcomes: Outcome[]): void {
  const t = tally(outcomes);
  console.log(`${B}${title}${R}  ${D}n=${t.total}${R}`);
  const rows: Array<[string, number]> = [
    ["correctly followed", t["followed-correct"]],
    ["correctly Outdated", t["outdated-correct"]],
    ["WRONGLY Outdated", t["wrongly-outdated"]],
    ["WRONGLY re-anchored", t["wrongly-reanchored"]],
  ];
  for (const [label, n] of rows) {
    const bad = label.startsWith("WRONGLY");
    console.log(
      `  ${bad ? "\x1b[31m" : ""}${label.padEnd(22)}${String(n).padStart(3)}  ${pct(n, t.total)}${R}`,
    );
  }
  console.log();
}

// -------------------------------------------------------- single-step tallies
console.log(`${D}Single-step results are strategy-independent: 'incremental' only differs from`);
console.log(`'original' on the SECOND and later migration of the same Anchor.${R}\n`);

const byLayer = new Map<Layer, Outcome[]>();
for (const layer of LAYERS) {
  const ms = cases.map((c) => measureCase(c, chains, layer)).filter((m) => !m.skipped);
  byLayer.set(
    layer,
    ms.map((m) => m.outcome),
  );
  printTally(
    `Single step — ${layer} layer`,
    ms.map((m) => m.outcome),
  );
}

// -------------------------------------------------------- failure attribution
for (const layer of LAYERS) {
  const ms = cases.map((c) => measureCase(c, chains, layer)).filter((m) => !m.skipped);
  const wrong = ms.filter((m) => m.outcome === "wrongly-outdated");
  if (!wrong.length) continue;
  console.log(
    `${B}Why the ${layer}-layer Anchors went wrongly Outdated${R}  ${D}n=${wrong.length}${R}`,
  );
  const kinds = new Map<string, number>();
  for (const m of wrong) kinds.set(m.failure ?? "?", (kinds.get(m.failure ?? "?") ?? 0) + 1);
  for (const [k, n] of [...kinds].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(22)}${String(n).padStart(3)}`);
  }
  const rescuable = wrong.filter((m) => m.exactWouldHaveWorked).length;
  console.log(
    `  ${D}of these, ${rescuable}/${wrong.length} would have resolved uniquely on 'exact' ALONE${R}\n`,
  );
}

// ------------------------- what an "exact-only fallback" would cost and rescue
console.log(
  `${B}Hypothetical: fall back to \`exact\` alone when context fails, if exact is unique${R}`,
);
for (const layer of LAYERS) {
  const ms = cases.map((c) => measureCase(c, chains, layer)).filter((m) => !m.skipped);
  const rescued = ms.filter(
    (m) => m.outcome === "wrongly-outdated" && m.exactWouldHaveWorked,
  ).length;
  const stillWrong = ms.filter(
    (m) => m.outcome === "wrongly-outdated" && !m.exactWouldHaveWorked,
  ).length;
  const broken = ms.filter((m) => m.outcome === "outdated-correct" && m.exactWouldHaveWorked);
  console.log(`  ${B}${layer}${R}`);
  console.log(
    `    ${GRNC}rescued (wrongly Outdated -> followed)   ${String(rescued).padStart(3)}${R}`,
  );
  console.log(
    `    ${D}still wrongly Outdated                   ${String(stillWrong).padStart(3)}${R}`,
  );
  console.log(
    `    ${RED}BROKEN (correctly Outdated -> re-anchor) ${String(broken.length).padStart(3)}${R}`,
  );
  for (const m of broken) console.log(`      ${D}${m.caseId}${R}`);
}
console.log();

// ------------------------------------------------ every wrongly-Outdated case
for (const layer of LAYERS) {
  const wrong = cases
    .map((c) => ({ c, m: measureCase(c, chains, layer) }))
    .filter(({ m }) => !m.skipped && m.outcome === "wrongly-outdated");
  console.log(`${B}Wrongly Outdated — ${layer} layer${R}`);
  for (const { c, m } of wrong) {
    console.log(`  ${B}${c.id}${R} ${D}${c.chain} v${c.from}→v${c.to} · ${c.category}${R}`);
    console.log(`    ${D}${c.note}${R}`);
    console.log(
      `    ${m.exactWouldHaveWorked ? "\x1b[33mexact still present & unique — context is what broke it\x1b[0m" : "exact gone/ambiguous"}`,
    );
  }
  console.log();
}

// ---------------------------------------------------------------- by category
for (const layer of LAYERS) {
  const ms = cases.map((c) => measureCase(c, chains, layer)).filter((m) => !m.skipped);
  console.log(`${B}By category — ${layer} layer${R}`);
  const cats = [...new Set(ms.map((m) => m.category))];
  for (const cat of cats) {
    const t = tally(ms.filter((m) => m.category === cat).map((m) => m.outcome));
    console.log(
      `  ${cat.padEnd(26)}${D}n=${String(t.total).padStart(2)}${R}  ok ${String(t["followed-correct"] + t["outdated-correct"]).padStart(2)}  ` +
        `\x1b[31mwrongOutdated ${String(t["wrongly-outdated"]).padStart(2)}  wrongAnchor ${String(t["wrongly-reanchored"]).padStart(2)}${R}`,
    );
  }
  console.log();
}

// --------------------------------------------------------------- chain cases
console.log(`${B}Chains — Anchor created at v1, carried to the newest revision${R}\n`);
for (const layer of LAYERS) {
  for (const strat of CHAIN_STRATEGIES) {
    const ms = chainCases
      .map((c) => measureChainCase(c, chains, layer, strat))
      .filter((m) => !m.skipped);
    printTally(
      `Chain — ${layer} / ${strat.key}`,
      ms.map((m) => m.outcome),
    );
  }
}

console.log(`${B}Chain detail (rendered layer)${R}`);
for (const c of chainCases) {
  const a = measureChainCase(c, chains, "rendered", CHAIN_STRATEGIES[0]!);
  const b = measureChainCase(c, chains, "rendered", CHAIN_STRATEGIES[1]!);
  if (a.skipped) {
    console.log(`  ${c.id.padEnd(28)} ${D}skipped: ${a.skipped}${R}`);
    continue;
  }
  const fmt = (m: typeof a) =>
    m.survived ? `survived (${m.outcome})` : `died at v${m.diedAt} (${m.outcome})`;
  const same = a.outcome === b.outcome && a.diedAt === b.diedAt;
  console.log(
    `  ${c.id.padEnd(28)} original: ${fmt(a).padEnd(34)} incremental: ${fmt(b)}${same ? "" : "   \x1b[33m<-- DIFFERS\x1b[0m"}`,
  );
}
console.log();

// ------------------------------------------------ does re-anchoring do anything?
console.log(`${B}Does the \`reanchored\` event ever change the quote?${R}`);
let steps = 0;
let diverged = 0;
const divExamples: string[] = [];
for (const layer of LAYERS) {
  for (const c of chainCases) {
    const d = measureRequoteDivergence(c, chains, layer);
    steps += d.successfulSteps;
    diverged += d.divergedSteps;
    for (const e of d.examples)
      if (divExamples.length < 3) divExamples.push(`${c.id} [${layer}] v${e.v}`);
  }
}
console.log(`  successful migrations across all chain cases : ${steps}`);
console.log(`  of those, re-expansion produced a NEW quote  : ${diverged}`);
if (divExamples.length) for (const e of divExamples) console.log(`    ${D}${e}${R}`);
console.log(`  ${D}A literal match means the stored context already equals the new surroundings,`);
console.log(`  so re-capturing at the match reproduces the same quote.${R}\n`);

// -------------------------------------- the dangerous class, over ALL positions
console.log(`${B}Anchors born ambiguous (precondition for a wrong re-anchor)${R}`);
console.log(`${D}Every line >=24 chars in every revision, captured with expandToUnique, then`);
console.log(
  `re-resolved in the SAME document. A failure here means the quote never was unique.${R}`,
);
for (const layer of LAYERS) {
  let positions = 0;
  let ambiguous = 0;
  const ex: string[] = [];
  for (const [slug, chain] of chains) {
    for (const rev of chain.loaded) {
      const b = measureBornAmbiguous(rev, slug, layer);
      positions += b.positions;
      ambiguous += b.ambiguous;
      for (const e of b.examples) if (ex.length < 4) ex.push(`${slug} v${rev.v}: ${e}`);
    }
  }
  console.log(
    `  ${layer.padEnd(9)} ${String(ambiguous).padStart(4)} / ${String(positions).padStart(5)} positions  ${pct(ambiguous, positions)}`,
  );
  for (const e of ex) console.log(`    ${D}${e}${R}`);
}
console.log();

// --------------------------------------------------------- decoy availability
console.log(`${B}Decoy material in the corpus (duplicated lines >=24 chars, per revision)${R}`);
for (const layer of LAYERS) {
  let dup = 0;
  let distinct = 0;
  let worst = { line: "", count: 0, where: "" };
  for (const [slug, chain] of chains) {
    for (const rev of chain.loaded) {
      const d = measureDecoyExposure(rev, slug, layer);
      dup += d.duplicatedLines;
      distinct += d.distinctLines;
      if (d.worstCount > worst.count)
        worst = { line: d.worstLine ?? "", count: d.worstCount, where: `${slug} v${rev.v}` };
    }
  }
  console.log(
    `  ${layer.padEnd(9)} ${String(dup).padStart(4)} / ${String(distinct).padStart(5)} distinct lines duplicated  ${pct(dup, distinct)}`,
  );
  if (worst.count)
    console.log(
      `    ${D}worst: x${worst.count} in ${worst.where} — ${worst.line.slice(0, 80)}${R}`,
    );
}
console.log();

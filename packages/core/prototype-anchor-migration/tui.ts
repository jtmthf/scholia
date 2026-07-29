// PROTOTYPE (issue #24) — THROWAWAY terminal shell over measure.ts.
// `pnpm prototype:anchors`
//
// Two views. The scoreboard is the answer; the case stepper is how you check
// that the answer is not an artifact of my labelling.
import { loadChains, readCases, selectionFor, expectFor, type Layer, type Case } from "./corpus.js";
import { expandToUnique } from "./expand.js";
import { measureCase, measureChainCase, tally, CHAIN_STRATEGIES } from "./measure.js";
import { locate, layerText } from "./corpus.js";

const B = "\x1b[1m";
const D = "\x1b[2m";
const R = "\x1b[0m";
const RED = "\x1b[31m";
const GRN = "\x1b[32m";
const YEL = "\x1b[33m";
const CYN = "\x1b[36m";

const chains = await loadChains();
const { cases, chainCases } = readCases();

type View = "scoreboard" | "cases" | "chains";
const state = { view: "scoreboard" as View, layer: "rendered" as Layer, idx: 0, onlyWrong: false };

function visible(): Case[] {
  if (!state.onlyWrong) return cases;
  return cases.filter((c) => {
    const m = measureCase(c, chains, state.layer);
    return !m.skipped && (m.outcome === "wrongly-outdated" || m.outcome === "wrongly-reanchored");
  });
}

function bar(n: number, total: number, color: string): string {
  const width = 28;
  const filled = total === 0 ? 0 : Math.round((n / total) * width);
  return `${color}${"█".repeat(filled)}${D}${"·".repeat(width - filled)}${R}`;
}

function ellipsis(s: string, n: number): string {
  const flat = s.replace(/\n/g, "\\n");
  return flat.length <= n ? flat : flat.slice(0, n - 1) + "…";
}

function renderScoreboard(): string[] {
  const out: string[] = [];
  out.push(
    `${B}Anchor migration accuracy${R}  ${D}issue #24 · ${cases.length} labelled cases · ${chainCases.length} chains${R}`,
  );
  out.push("");

  for (const layer of ["rendered", "source"] as Layer[]) {
    const ms = cases.map((c) => measureCase(c, chains, layer)).filter((m) => !m.skipped);
    const t = tally(ms.map((m) => m.outcome));
    const mark = layer === state.layer ? `${CYN}▸${R}` : " ";
    out.push(`${mark} ${B}single step — ${layer}${R} ${D}n=${t.total}${R}`);
    const rows: Array<[string, number, string]> = [
      ["correctly followed", t["followed-correct"], GRN],
      ["correctly Outdated", t["outdated-correct"], GRN],
      ["WRONGLY Outdated", t["wrongly-outdated"], RED],
      ["WRONGLY re-anchored", t["wrongly-reanchored"], RED],
    ];
    for (const [label, n, color] of rows) {
      const p = t.total === 0 ? 0 : Math.round((n / t.total) * 100);
      out.push(
        `    ${label.padEnd(21)} ${bar(n, t.total, color)} ${String(n).padStart(3)}  ${String(p).padStart(3)}%`,
      );
    }
    const wrong = ms.filter((m) => m.outcome === "wrongly-outdated");
    const rescuable = wrong.filter((m) => m.exactWouldHaveWorked).length;
    out.push(
      `    ${D}${rescuable}/${wrong.length} of the wrongly-Outdated would have matched on \`exact\` alone${R}`,
    );
    out.push("");
  }

  out.push(`${B}chains — Anchor made at v1, carried to the newest revision${R}`);
  for (const strat of CHAIN_STRATEGIES) {
    const ms = chainCases
      .map((c) => measureChainCase(c, chains, state.layer, strat))
      .filter((m) => !m.skipped);
    const t = tally(ms.map((m) => m.outcome));
    out.push(
      `    ${strat.key.padEnd(12)} ${D}n=${t.total}${R}  ${GRN}ok ${t["followed-correct"] + t["outdated-correct"]}${R}  ` +
        `${RED}wrongOutdated ${t["wrongly-outdated"]}  wrongAnchor ${t["wrongly-reanchored"]}${R}`,
    );
  }
  out.push(`    ${YEL}the two strategies are identical on every case${R}`);
  return out;
}

function renderCase(): string[] {
  const list = visible();
  const out: string[] = [];
  if (list.length === 0) return [`${D}no cases match the filter${R}`];
  const c = list[state.idx % list.length]!;
  const m = measureCase(c, chains, state.layer);

  const color = m.outcome === "wrongly-outdated" || m.outcome === "wrongly-reanchored" ? RED : GRN;

  out.push(
    `${B}${c.id}${R}  ${D}${(state.idx % list.length) + 1}/${list.length} · ${state.layer}${R}`,
  );
  out.push(`${D}${c.chain} v${c.from} → v${c.to} · ${c.category}${R}`);
  out.push("");
  out.push(`${B}note${R}      ${ellipsis(c.note, 96)}`);
  out.push(`${B}truth${R}     ${expectFor(c, state.layer)}`);
  out.push(
    `${B}outcome${R}   ${color}${m.outcome}${R}${m.failure ? `  ${D}(${m.failure})${R}` : ""}`,
  );
  if (m.skipped) out.push(`${YEL}skipped: ${m.skipped}${R}`);
  out.push("");

  const chain = chains.get(c.chain);
  const before = chain?.loaded.find((r) => r.v === c.from);
  if (before) {
    const text = layerText(before, state.layer);
    const at = locate(text, selectionFor(c, state.layer));
    if (at) {
      const q = expandToUnique(text, at.start, at.end);
      out.push(`${B}captured quote${R} ${D}(as the iframe would build it)${R}`);
      out.push(`  ${D}prefix${R} ${ellipsis(q.prefix ?? "", 88)}`);
      out.push(`  ${CYN}exact ${R} ${ellipsis(q.exact, 88)}`);
      out.push(`  ${D}suffix${R} ${ellipsis(q.suffix ?? "", 88)}`);
      out.push("");
    }
  }

  out.push(
    `${B}landed on${R} ${m.landedOn === null ? `${D}— (Outdated)${R}` : ellipsis(m.landedOn, 88)}`,
  );
  out.push(`${B}expected ${R} ${ellipsis(m.expected, 88)}`);
  if (m.outcome === "wrongly-outdated") {
    out.push("");
    out.push(
      m.exactWouldHaveWorked
        ? `${YEL}the exact text is still there, uniquely. only the stored context moved.${R}`
        : `${D}the exact text is genuinely gone or ambiguous.${R}`,
    );
  }
  return out;
}

function renderChains(): string[] {
  const out: string[] = [];
  out.push(`${B}chain cases — ${state.layer}${R}`);
  out.push("");
  for (const c of chainCases) {
    const a = measureChainCase(c, chains, state.layer, CHAIN_STRATEGIES[0]!);
    const b = measureChainCase(c, chains, state.layer, CHAIN_STRATEGIES[1]!);
    if (a.skipped) {
      out.push(`  ${c.id.padEnd(26)} ${D}${a.skipped}${R}`);
      continue;
    }
    const track = a.steps
      .map((s) => (s.verdict === "live" ? `${GRN}●${R}` : `${RED}○${R}`))
      .join("");
    const same = a.outcome === b.outcome && a.diedAt === b.diedAt;
    const color = a.outcome.startsWith("wrongly") ? RED : GRN;
    out.push(
      `  ${c.id.padEnd(26)} ${track.padEnd(10)} ${color}${a.outcome.padEnd(19)}${R}` +
        (same ? `${D}incremental identical${R}` : `${YEL}incremental DIFFERS: ${b.outcome}${R}`),
    );
  }
  out.push("");
  out.push(`  ${D}● migrated  ○ Outdated (and every later Version, once Outdated)${R}`);
  return out;
}

function draw(): void {
  console.clear();
  const body =
    state.view === "scoreboard"
      ? renderScoreboard()
      : state.view === "cases"
        ? renderCase()
        : renderChains();
  console.log(body.join("\n"));
  console.log("");
  console.log(
    `${D}${R}${B}[s]${R}${D}coreboard ${R}${B}[c]${R}${D}ases ${R}${B}[h]${R}${D}chains ` +
      `${R}${B}[j/k]${R}${D} prev/next ${R}${B}[l]${R}${D} layer=${state.layer} ` +
      `${R}${B}[w]${R}${D} only-wrong=${state.onlyWrong} ${R}${B}[q]${R}${D}uit${R}`,
  );
}

draw();

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (key: string) => {
  const k = key.toString();
  if (k === "q" || k === "") {
    process.stdin.setRawMode?.(false);
    console.clear();
    process.exit(0);
  }
  if (k === "s") state.view = "scoreboard";
  if (k === "c") state.view = "cases";
  if (k === "h") state.view = "chains";
  if (k === "l") state.layer = state.layer === "rendered" ? "source" : "rendered";
  if (k === "w") {
    state.onlyWrong = !state.onlyWrong;
    state.idx = 0;
  }
  if (k === "j") state.idx = (state.idx + 1) % Math.max(1, visible().length);
  if (k === "k")
    state.idx = (state.idx - 1 + Math.max(1, visible().length)) % Math.max(1, visible().length);
  draw();
});

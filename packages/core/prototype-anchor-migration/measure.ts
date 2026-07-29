// PROTOTYPE (issue #24) — pure corpus -> tally. No I/O, no terminal code.
import { expandToUnique } from "./expand.js";
import { original, incremental, type FailureKind, type Strategy } from "./strategies.js";
import { searchQuote } from "../src/anchor/quote.js";
import {
  layerText,
  locate,
  selectionFor,
  expectFor,
  expectTextFor,
  type Case,
  type ChainCase,
  type Layer,
  type LoadedChain,
} from "./corpus.js";
import type { Anchor } from "../src/anchor/types.js";

/** The four tallies issue #24 asks for. `wrongly-reanchored` is the dangerous class. */
export type Outcome =
  | "followed-correct"
  | "outdated-correct"
  | "wrongly-outdated"
  | "wrongly-reanchored";

export interface StepMeasurement {
  caseId: string;
  layer: Layer;
  category: Case["category"];
  outcome: Outcome;
  failure: FailureKind | null;
  /** What the Anchor actually landed on, when it stayed live. */
  landedOn: string | null;
  expected: string;
  /** True when `exact` alone would have resolved uniquely — i.e. the mandatory
   *  context is what killed it. */
  exactWouldHaveWorked: boolean;
  skipped: string | null;
}

function uniqueCount(text: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let pos = 0;
  while ((pos = text.indexOf(needle, pos)) !== -1) {
    n++;
    pos += needle.length;
  }
  return n;
}

export function measureCase(
  c: Case,
  chains: Map<string, LoadedChain>,
  layer: Layer,
): StepMeasurement {
  const base: Omit<
    StepMeasurement,
    "outcome" | "failure" | "landedOn" | "exactWouldHaveWorked" | "skipped"
  > = {
    caseId: c.id,
    layer,
    category: c.category,
    expected: expectFor(c, layer) === "follow" ? expectTextFor(c, layer) : "(Outdated)",
  };
  const skip = (why: string): StepMeasurement => ({
    ...base,
    outcome: "outdated-correct",
    failure: null,
    landedOn: null,
    exactWouldHaveWorked: false,
    skipped: why,
  });

  const chain = chains.get(c.chain);
  if (!chain) return skip(`no chain ${c.chain}`);
  const before = chain.loaded.find((r) => r.v === c.from);
  const after = chain.loaded.find((r) => r.v === c.to);
  if (!before || !after) return skip(`missing revision ${c.from}->${c.to}`);

  const beforeText = layerText(before, layer);
  const afterText = layerText(after, layer);
  const sel = selectionFor(c, layer);
  const at = locate(beforeText, sel);
  if (!at) return skip(`selection not uniquely present in ${layer} v${c.from}`);

  // Capture the Anchor exactly as the iframe would.
  const anchor: Anchor = { textQuote: expandToUnique(beforeText, at.start, at.end) };
  const res = original.step(anchor, afterText);

  const exactWouldHaveWorked = uniqueCount(afterText, anchor.textQuote.exact) === 1;

  const want = expectFor(c, layer);

  if (res.verdict === "outdated") {
    return {
      ...base,
      outcome: want === "outdated" ? "outdated-correct" : "wrongly-outdated",
      failure: res.failure,
      landedOn: null,
      exactWouldHaveWorked,
      skipped: null,
    };
  }

  const landedOn = afterText.slice(res.span!.start, res.span!.end);
  const correct = want === "follow" && landedOn === expectTextFor(c, layer);
  return {
    ...base,
    outcome: correct ? "followed-correct" : "wrongly-reanchored",
    failure: null,
    landedOn,
    exactWouldHaveWorked,
    skipped: null,
  };
}

export interface ChainStep {
  v: number;
  subject: string;
  verdict: "live" | "outdated";
  failure: FailureKind | null;
  landedOn: string | null;
}

export interface ChainMeasurement {
  caseId: string;
  layer: Layer;
  strategy: Strategy["key"];
  steps: ChainStep[];
  /** Index of the first step that went Outdated, or null if it survived. */
  diedAt: number | null;
  survived: boolean;
  outcome: Outcome;
  landedOn: string | null;
  expected: string;
  skipped: string | null;
}

export function measureChainCase(
  c: ChainCase,
  chains: Map<string, LoadedChain>,
  layer: Layer,
  strategy: Strategy,
): ChainMeasurement {
  const base = {
    caseId: c.id,
    layer,
    strategy: strategy.key,
    expected: c.expectAtEnd === "follow" ? expectTextFor(c, layer) : "(Outdated)",
  };
  const skip = (why: string): ChainMeasurement => ({
    ...base,
    steps: [],
    diedAt: null,
    survived: false,
    outcome: "outdated-correct",
    landedOn: null,
    skipped: why,
  });

  const chain = chains.get(c.chain);
  if (!chain || chain.loaded.length < 2) return skip(`no usable chain ${c.chain}`);

  const v1 = chain.loaded[0]!;
  const beforeText = layerText(v1, layer);
  const sel = selectionFor(c, layer);
  const at = locate(beforeText, sel);
  if (!at) return skip(`selection not uniquely present in ${layer} v1`);

  let anchor: Anchor = { textQuote: expandToUnique(beforeText, at.start, at.end) };
  const steps: ChainStep[] = [];
  let diedAt: number | null = null;
  let landedOn: string | null = null;

  for (const rev of chain.loaded.slice(1)) {
    const text = layerText(rev, layer);
    // Once Outdated, the Anchor stays Outdated — it is not retried against later
    // Versions (that is what "Outdated" means in CONTEXT.md).
    if (diedAt !== null) {
      steps.push({
        v: rev.v,
        subject: rev.subject,
        verdict: "outdated",
        failure: null,
        landedOn: null,
      });
      continue;
    }
    const res = strategy.step(anchor, text);
    if (res.verdict === "outdated") {
      diedAt = rev.v;
      landedOn = null;
      steps.push({
        v: rev.v,
        subject: rev.subject,
        verdict: "outdated",
        failure: res.failure,
        landedOn: null,
      });
      continue;
    }
    anchor = res.next;
    landedOn = text.slice(res.span!.start, res.span!.end);
    steps.push({ v: rev.v, subject: rev.subject, verdict: "live", failure: null, landedOn });
  }

  const survived = diedAt === null;
  let outcome: Outcome;
  if (!survived) {
    outcome = c.expectAtEnd === "outdated" ? "outdated-correct" : "wrongly-outdated";
  } else {
    outcome =
      c.expectAtEnd === "follow" && landedOn === expectTextFor(c, layer)
        ? "followed-correct"
        : "wrongly-reanchored";
  }

  return { ...base, steps, diedAt, survived, outcome, landedOn, skipped: null };
}

/**
 * Does incremental re-anchoring ever actually produce a DIFFERENT quote?
 *
 * Under literal matching it should not: a successful `searchQuote` means the
 * stored prefix/suffix are already literal substrings of the new text at the
 * matched position, so re-expanding there reproduces the same context. This
 * measures that claim instead of asserting it.
 */
export interface RequoteDivergence {
  caseId: string;
  layer: Layer;
  successfulSteps: number;
  divergedSteps: number;
  examples: Array<{ v: number; before: string; after: string }>;
}

export function measureRequoteDivergence(
  c: ChainCase,
  chains: Map<string, LoadedChain>,
  layer: Layer,
): RequoteDivergence {
  const out: RequoteDivergence = {
    caseId: c.id,
    layer,
    successfulSteps: 0,
    divergedSteps: 0,
    examples: [],
  };
  const chain = chains.get(c.chain);
  if (!chain || chain.loaded.length < 2) return out;

  const v1 = chain.loaded[0]!;
  const beforeText = layerText(v1, layer);
  const at = locate(beforeText, selectionFor(c, layer));
  if (!at) return out;

  let anchor: Anchor = { textQuote: expandToUnique(beforeText, at.start, at.end) };
  for (const rev of chain.loaded.slice(1)) {
    const res = incremental.step(anchor, layerText(rev, layer));
    if (res.verdict === "outdated") break;
    out.successfulSteps++;
    const before = JSON.stringify(anchor.textQuote);
    const after = JSON.stringify(res.next.textQuote);
    if (before !== after) {
      out.divergedSteps++;
      if (out.examples.length < 3) out.examples.push({ v: rev.v, before, after });
    }
    anchor = res.next;
  }
  return out;
}

/**
 * How much decoy material is actually out there? A wrong re-anchor needs the
 * quote to resolve uniquely at a location that is not the right one, which needs
 * duplicated text. This counts, per revision, the non-trivial lines that appear
 * more than once in the same document.
 */
export interface DecoyExposure {
  chain: string;
  v: number;
  layer: Layer;
  distinctLines: number;
  duplicatedLines: number;
  worstLine: string | null;
  worstCount: number;
}

export function measureDecoyExposure(
  rev: LoadedRevisionLike,
  chain: string,
  layer: Layer,
): DecoyExposure {
  const text = layer === "rendered" ? rev.rendered : rev.source;
  const counts = new Map<string, number>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    // Ignore trivia: blank lines, fences, table rules — nobody anchors a comment there.
    if (line.length < 24) continue;
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  let duplicated = 0;
  let worstLine: string | null = null;
  let worstCount = 0;
  for (const [line, n] of counts) {
    if (n > 1) {
      duplicated++;
      if (n > worstCount) {
        worstCount = n;
        worstLine = line;
      }
    }
  }
  return {
    chain,
    v: rev.v,
    layer,
    distinctLines: counts.size,
    duplicatedLines: duplicated,
    worstLine,
    worstCount,
  };
}

interface LoadedRevisionLike {
  v: number;
  source: string;
  rendered: string;
}

/**
 * The precondition for the dangerous class, measured over EVERY plausible anchor
 * position in the corpus rather than just the hand-labelled cases.
 *
 * `expandToUnique` gives up at MAX_CONTEXT=200 and returns a best-effort quote
 * even when that quote is still ambiguous — with no signal to the caller. An
 * Anchor born that way is already broken: `searchQuote` finds >1 match, so it is
 * Outdated on arrival, and if a later Version deletes all but one occurrence it
 * silently "migrates" to whichever copy survived. That is the wrongly-re-anchored
 * failure, and it needs no fuzzy matching to happen.
 */
export interface BornAmbiguous {
  chain: string;
  v: number;
  layer: Layer;
  positions: number;
  ambiguous: number;
  examples: string[];
}

export function measureBornAmbiguous(
  rev: LoadedRevisionLike,
  chain: string,
  layer: Layer,
): BornAmbiguous {
  const text = layer === "rendered" ? rev.rendered : rev.source;
  const out: BornAmbiguous = { chain, v: rev.v, layer, positions: 0, ambiguous: 0, examples: [] };

  let offset = 0;
  for (const raw of text.split("\n")) {
    const start = offset;
    offset += raw.length + 1;
    const line = raw.trim();
    // Only lines a human would plausibly select as a comment target.
    if (line.length < 24) continue;
    const lineStart = start + raw.indexOf(line);
    const lineEnd = lineStart + line.length;
    out.positions++;

    const quote = expandToUnique(text, lineStart, lineEnd);
    // Born ambiguous: the freshly captured quote does not resolve uniquely in the
    // very document it was captured from.
    if (searchQuoteUnique(text, quote) === null) {
      out.ambiguous++;
      if (out.examples.length < 3) out.examples.push(line.slice(0, 90));
    }
  }
  return out;
}

function searchQuoteUnique(text: string, quote: Anchor["textQuote"]) {
  return searchQuote(text, quote);
}

export interface Tally {
  "followed-correct": number;
  "outdated-correct": number;
  "wrongly-outdated": number;
  "wrongly-reanchored": number;
  total: number;
}

export function tally(outcomes: Outcome[]): Tally {
  const t: Tally = {
    "followed-correct": 0,
    "outdated-correct": 0,
    "wrongly-outdated": 0,
    "wrongly-reanchored": 0,
    total: outcomes.length,
  };
  for (const o of outcomes) t[o]++;
  return t;
}

export const CHAIN_STRATEGIES = [original, incremental];

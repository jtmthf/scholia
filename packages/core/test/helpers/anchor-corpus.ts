// Loader for the committed anchor-migration corpus
// (test/fixtures/anchor-migration/ — see its README).
//
// The measurement harness that produced the corpus is a throwaway prototype, so
// this is a deliberately trimmed, permanent re-implementation of the parts a
// regression test needs: materialise both text layers for a revision, find a
// labelled selection in one, and expand it into a quote exactly the way a real
// capture would.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderedText } from "../../src/ingest/rendered-text.js";
import { renderMarkdown } from "../../src/render/markdown.js";
import type { TextQuote } from "../../src/anchor/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "fixtures", "anchor-migration");
const CHAINS = join(FIXTURES, "chains");

/** "rendered" is what hosted migration matches against; "source" is the raw markdown. */
export type Layer = "rendered" | "source";
export const LAYERS: Layer[] = ["rendered", "source"];

export type Verdict = "follow" | "outdated";

export interface Case {
  id: string;
  chain: string;
  from: number;
  to: number;
  category: string;
  selection: string;
  renderedSelection?: string;
  expect: Verdict;
  expectSource?: Verdict;
  expectRendered?: Verdict;
  expectText?: string;
  renderedExpectText?: string;
  note: string;
}

interface Revision {
  v: number;
  file: string;
}

export interface LoadedRevision {
  source: string;
  rendered: string;
}

export function readCases(): Case[] {
  const parsed = JSON.parse(readFileSync(join(FIXTURES, "cases.json"), "utf8")) as {
    cases: Case[];
  };
  return parsed.cases;
}

/** Every revision of every chain, keyed `<chain>@<v>`. */
export async function loadRevisions(): Promise<Map<string, LoadedRevision>> {
  const { chains } = JSON.parse(readFileSync(join(CHAINS, "chains.json"), "utf8")) as {
    chains: Array<{ slug: string; revisions: Revision[] }>;
  };

  const out = new Map<string, LoadedRevision>();
  for (const chain of chains) {
    for (const rev of chain.revisions) {
      const source = readFileSync(join(CHAINS, chain.slug, rev.file), "utf8");
      const { html } = await renderMarkdown(source);
      out.set(`${chain.slug}@${rev.v}`, { source, rendered: renderedText(html) });
    }
  }
  return out;
}

export function layerText(rev: LoadedRevision, layer: Layer): string {
  return layer === "rendered" ? rev.rendered : rev.source;
}

export function selectionFor(c: Case, layer: Layer): string {
  return layer === "rendered" ? (c.renderedSelection ?? c.selection) : c.selection;
}

/** Ground truth, honouring the per-layer overrides the corpus records. */
export function expectFor(c: Case, layer: Layer): Verdict {
  return (layer === "rendered" ? c.expectRendered : c.expectSource) ?? c.expect;
}

/** Where a "follow" case should land in the new revision. */
export function expectTextFor(c: Case, layer: Layer): string {
  if (layer === "rendered")
    return c.renderedExpectText ?? c.expectText ?? selectionFor(c, "rendered");
  return c.expectText ?? c.selection;
}

/** Locate a selection. Requires exactly one occurrence — an ambiguous selection
 *  would make the ground-truth label meaningless. */
export function locate(text: string, needle: string): { start: number; end: number } | null {
  const first = text.indexOf(needle);
  if (first === -1) return null;
  if (text.indexOf(needle, first + needle.length) !== -1) return null;
  return { start: first, end: first + needle.length };
}

const START_CONTEXT = 32;
const MAX_CONTEXT = 200;

function countOccurrences(text: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

/**
 * Expand context around `text[start, end)` until the quote is unique. Mirrors
 * the iframe's `buildUniqueQuote` (packages/bridge/src/iframe/entry.ts),
 * including its habit of attaching context even when `exact` is already unique
 * — which is the behaviour the exact-only fallback exists to compensate for, so
 * the test would be meaningless without it.
 */
export function expandToUnique(text: string, start: number, end: number): TextQuote {
  const exact = text.slice(start, end);
  let ctxLen = START_CONTEXT;

  for (;;) {
    const prefix = text.slice(Math.max(0, start - ctxLen), start);
    const suffix = text.slice(end, Math.min(text.length, end + ctxLen));

    if (countOccurrences(text, exact) <= 1) {
      return { exact, prefix: prefix || undefined, suffix: suffix || undefined };
    }
    if (countOccurrences(text, prefix + exact + suffix) <= 1) {
      return { exact, prefix: prefix || undefined, suffix: suffix || undefined };
    }
    if (ctxLen >= MAX_CONTEXT) {
      return {
        exact,
        prefix: text.slice(Math.max(0, start - MAX_CONTEXT), start) || undefined,
        suffix: text.slice(end, Math.min(text.length, end + MAX_CONTEXT)) || undefined,
      };
    }
    ctxLen = Math.min(ctxLen * 2, MAX_CONTEXT);
  }
}

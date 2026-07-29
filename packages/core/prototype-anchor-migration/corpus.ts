// PROTOTYPE (issue #24) — loads the committed fixture corpus and materialises
// both text layers for every revision.
//
// Two layers, measured separately (issue #24 contrasts the hosted and local paths):
//   - "rendered" — renderMarkdown -> renderedText. Exactly what hosted
//     `migrateAnchor` matches against at an upload boundary.
//   - "source"   — the raw markdown bytes. What a local, live-file re-resolve
//     would see if it matched the file the agent is actually editing.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderMarkdown } from "../src/render/markdown.js";
import { renderedText } from "../src/ingest/rendered-text.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(HERE, "..", "test", "fixtures", "anchor-migration");
const CHAINS = join(FIXTURES, "chains");

export type Layer = "rendered" | "source";
export const LAYERS: Layer[] = ["rendered", "source"];

export type Category =
  | "reworded-sentence"
  | "moved-paragraph"
  | "split-or-merged-sections"
  | "renamed-heading"
  | "wholesale-rewrite";

export const CATEGORIES: Category[] = [
  "reworded-sentence",
  "moved-paragraph",
  "split-or-merged-sections",
  "renamed-heading",
  "wholesale-rewrite",
];

export interface Revision {
  v: number;
  commit: string;
  date: string;
  subject: string;
  file: string;
  bytes: number;
}

export interface Chain {
  slug: string;
  path: string;
  revisions: Revision[];
}

/** A hand-labelled single-step case: one Anchor, one before/after pair. */
export interface Case {
  id: string;
  chain: string;
  from: number;
  to: number;
  category: Category;
  /** The span a human selected, as it appears in the SOURCE markdown of `from`. */
  selection: string;
  /** Same span in the RENDERED text, when markdown markup makes it differ. */
  renderedSelection?: string;
  /** Ground truth: should this Anchor follow into `to`, or honestly go Outdated? */
  expect: "follow" | "outdated";
  /** Per-layer ground truth. A formatter run (`*x*` -> `_x_`) changes the source
   *  but leaves the rendered text byte-identical, so the honest answer differs. */
  expectSource?: "follow" | "outdated";
  expectRendered?: "follow" | "outdated";
  /** When the expectation is "follow", the text it should land on in `to`. Defaults to the selection. */
  expectText?: string;
  renderedExpectText?: string;
  note: string;
}

/** A chain case: one Anchor created at v1, carried to the end of the chain. */
export interface ChainCase {
  id: string;
  chain: string;
  selection: string;
  renderedSelection?: string;
  /** Ground truth at the LAST revision only. */
  expectAtEnd: "follow" | "outdated";
  expectText?: string;
  renderedExpectText?: string;
  note: string;
}

export interface CorpusFile {
  cases: Case[];
  chainCases: ChainCase[];
}

export interface LoadedRevision extends Revision {
  source: string;
  rendered: string;
}

export interface LoadedChain extends Chain {
  loaded: LoadedRevision[];
}

export function readChains(): Chain[] {
  return (JSON.parse(readFileSync(join(CHAINS, "chains.json"), "utf8")) as { chains: Chain[] })
    .chains;
}

export function readCases(): CorpusFile {
  return JSON.parse(readFileSync(join(FIXTURES, "cases.json"), "utf8")) as CorpusFile;
}

export async function loadChains(): Promise<Map<string, LoadedChain>> {
  const out = new Map<string, LoadedChain>();
  for (const chain of readChains()) {
    const loaded: LoadedRevision[] = [];
    for (const rev of chain.revisions) {
      const source = readFileSync(join(CHAINS, chain.slug, rev.file), "utf8");
      const { html } = await renderMarkdown(source);
      loaded.push({ ...rev, source, rendered: renderedText(html) });
    }
    out.set(chain.slug, { ...chain, loaded });
  }
  return out;
}

export function layerText(rev: LoadedRevision, layer: Layer): string {
  return layer === "rendered" ? rev.rendered : rev.source;
}

/** The selection string for a case in a given layer. */
export function selectionFor(
  c: { selection: string; renderedSelection?: string },
  layer: Layer,
): string {
  return layer === "rendered" ? (c.renderedSelection ?? c.selection) : c.selection;
}

/** Ground truth for a case in a given layer, honouring per-layer overrides. */
export function expectFor(
  c: {
    expect: "follow" | "outdated";
    expectSource?: "follow" | "outdated";
    expectRendered?: "follow" | "outdated";
  },
  layer: Layer,
): "follow" | "outdated" {
  return (layer === "rendered" ? c.expectRendered : c.expectSource) ?? c.expect;
}

export function expectTextFor(
  c: {
    selection: string;
    renderedSelection?: string;
    expectText?: string;
    renderedExpectText?: string;
  },
  layer: Layer,
): string {
  if (layer === "rendered")
    return c.renderedExpectText ?? c.expectText ?? selectionFor(c, "rendered");
  return c.expectText ?? c.selection;
}

/** Locate a selection in a text. Requires exactly one occurrence — an ambiguous
 *  selection would make ground truth meaningless. */
export function locate(text: string, needle: string): { start: number; end: number } | null {
  const first = text.indexOf(needle);
  if (first === -1) return null;
  if (text.indexOf(needle, first + needle.length) !== -1) return null;
  return { start: first, end: first + needle.length };
}

// HTML Page ingest for hosting (PLAN §5 M4, ADR-0003). An HTML Page's canonical
// source is HTML; it is served as a rendered page and comments anchor directly
// to the DOM (CONTEXT "HTML Page"). We parse with parse5 using
// `sourceCodeLocationInfo` so every element maps back to a character range in
// the original source — the HTML flavor of the Markdown Source Map, giving M5
// anchoring a source range alongside the DOM xpath/css.
//
// We deliberately do NOT sanitize: uploaded page JS is preserved (ADR-0003 —
// interactivity is why someone hosts HTML), and the cross-origin sandboxed
// iframe plus the content-origin CSP contain the blast radius. Hosted HTML is
// always static (ADR-0012); we only stamp `data-sm` ids and re-serialize.
import { parse, serialize, defaultTreeAdapter } from "parse5";
import GithubSlugger from "github-slugger";
import {
  SOURCE_MAP_ATTR,
  serializeSourceMap,
  type SourceMap,
  type SourceMapEntry,
} from "./source-map.js";
import type { Heading } from "../types.js";

// parse5's default tree adapter is loosely typed; these are the only node
// shapes we touch.
interface P5Node {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: P5Node[];
  sourceCodeLocation?: { startOffset: number; endOffset: number } | null;
}

export interface HtmlIngest {
  /** Served HTML document, with `data-sm` ids stamped for anchoring. */
  html: string;
  title: string | undefined;
  headings: Heading[];
  /** Source Map: `data-sm` id -> character range in the original HTML source. */
  sourceMap: SourceMap;
}

// Structural / non-visible elements that carry no anchorable prose. Skipped when
// stamping `data-sm` so the Source Map only covers content a reviewer can select.
const SKIP_TAGS = new Set([
  "html",
  "head",
  "body",
  "script",
  "style",
  "meta",
  "link",
  "title",
  "base",
  "noscript",
  "template",
]);

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

function getAttr(node: P5Node, name: string): string | undefined {
  return node.attrs?.find((a) => a.name === name)?.value;
}

function setAttr(node: P5Node, name: string, value: string): void {
  node.attrs = node.attrs ?? [];
  const existing = node.attrs.find((a) => a.name === name);
  if (existing) existing.value = value;
  else node.attrs.push({ name, value });
}

// Concatenate the text content of an element subtree.
function textOf(node: P5Node): string {
  if (node.nodeName === "#text") return node.value ?? "";
  let out = "";
  for (const child of node.childNodes ?? []) out += textOf(child);
  return out;
}

export function ingestHtml(source: string): HtmlIngest {
  const doc = parse(source, { sourceCodeLocationInfo: true }) as unknown as P5Node;
  const entries: SourceMapEntry[] = [];
  const headings: Heading[] = [];
  const slugger = new GithubSlugger();
  let titleEl: string | undefined;
  let firstH1: string | undefined;

  const visit = (node: P5Node): void => {
    const tag = node.tagName;
    if (tag) {
      if (tag === "title" && titleEl === undefined) {
        const t = textOf(node).trim();
        if (t) titleEl = t;
      }
      if (HEADING_TAGS.has(tag)) {
        const text = textOf(node).trim();
        const depth = Number(tag[1]);
        const id = getAttr(node, "id") ?? slugger.slug(text);
        if (text) {
          headings.push({ depth, id, text });
          if (depth === 1 && firstH1 === undefined) firstH1 = text;
        }
      }
      if (!SKIP_TAGS.has(tag) && node.sourceCodeLocation) {
        const { startOffset, endOffset } = node.sourceCodeLocation;
        if (startOffset != null && endOffset != null) {
          const id = entries.length;
          setAttr(node, SOURCE_MAP_ATTR, String(id));
          entries.push({ id, tag, start: startOffset, end: endOffset });
        }
      }
    }
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(doc);

  const html = serialize(doc as never, { treeAdapter: defaultTreeAdapter });
  const title = titleEl ?? firstH1;

  return { html, title, headings, sourceMap: serializeSourceMap(entries) };
}

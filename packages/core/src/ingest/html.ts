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
import { parse, serialize, serializeOuter, defaultTreeAdapter } from "parse5";
import GithubSlugger from "github-slugger";
import {
  SOURCE_MAP_ATTR,
  serializeSourceMap,
  type SourceMap,
  type SourceMapEntry,
} from "./source-map.js";
import { scopeToArticle } from "./scope-css.js";
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
  /**
   * Just the `<body>`'s children, stamped the same way — for a consumer that
   * embeds an HTML Page inside a document of its own rather than serving it
   * whole. Local Preview does that, because its chrome and the Page share one
   * document (there is no content frame locally).
   */
  bodyHtml: string;
  /**
   * The Page's own `<style>` and stylesheet `<link>`s, in head order. An embedding
   * consumer has to hoist these or the Page renders unstyled; they are separated
   * out rather than left in `bodyHtml` so the consumer decides where they land.
   */
  styleHtml: string;
  title: string | undefined;
  headings: Heading[];
  /** Source Map: `data-sm` id -> character range in the original HTML source. */
  sourceMap: SourceMap;
}

// The first descendant with this tag name — parse5 always synthesises <html>,
// <head> and <body>, however malformed the source was.
function findTag(node: P5Node, tag: string): P5Node | undefined {
  if (node.tagName === tag) return node;
  for (const child of node.childNodes ?? []) {
    const found = findTag(child, tag);
    if (found) return found;
  }
  return undefined;
}

function isStylesheet(node: P5Node): boolean {
  if (node.tagName === "style") return true;
  if (node.tagName !== "link") return false;
  return (getAttr(node, "rel") ?? "").toLowerCase().split(/\s+/).includes("stylesheet");
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

export interface HtmlMeta {
  /** `<title>` if there is one, else the first `<h1>` (CONTEXT "Page"). */
  title: string | undefined;
  headings: Heading[];
}

/**
 * Walk a parsed document, collecting its title and Outline and running `onNode`
 * over every element on the way.
 *
 * The title/Outline rule is one rule and lives in one place; what differs
 * between the two callers is only what else they do with each node — nothing,
 * for a Nav scan, and `data-sm` stamping for a full ingest.
 */
function walkHtml(doc: P5Node, onNode?: (node: P5Node, tag: string) => void): HtmlMeta {
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
        if (text) {
          const depth = Number(tag[1]);
          headings.push({ depth, id: getAttr(node, "id") ?? slugger.slug(text), text });
          if (depth === 1 && firstH1 === undefined) firstH1 = text;
        }
      }
      onNode?.(node, tag);
    }
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(doc);

  return { title: titleEl ?? firstH1, headings };
}

export function ingestHtml(source: string): HtmlIngest {
  const doc = parse(source, { sourceCodeLocationInfo: true }) as unknown as P5Node;
  const entries: SourceMapEntry[] = [];

  const { title, headings } = walkHtml(doc, (node, tag) => {
    if (SKIP_TAGS.has(tag) || !node.sourceCodeLocation) return;
    const { startOffset, endOffset } = node.sourceCodeLocation;
    if (startOffset === null || endOffset === null) return;
    const id = entries.length;
    setAttr(node, SOURCE_MAP_ATTR, String(id));
    entries.push({ id, tag, start: startOffset, end: endOffset });
  });

  const html = serialize(doc as never, { treeAdapter: defaultTreeAdapter });

  // `serialize` emits a node's children, which is exactly the body's inner HTML.
  const body = findTag(doc, "body");
  const bodyHtml = body ? serialize(body as never, { treeAdapter: defaultTreeAdapter }) : "";

  // `styleHtml` is only ever hoisted into an embedding consumer's own document
  // (Local Preview's chrome) — `html` above, the whole served document, is
  // untouched. `<link>` stylesheets stay verbatim: the CSS lives in a file we
  // don't have here to rewrite.
  function scopeStyleNode(node: P5Node): void {
    if (node.tagName !== "style") return;
    const text = node.childNodes?.find((c) => c.nodeName === "#text");
    if (text) text.value = scopeToArticle(text.value ?? "");
  }

  const head = findTag(doc, "head");
  const styleHtml = (head?.childNodes ?? [])
    .filter(isStylesheet)
    .map((node) => {
      scopeStyleNode(node);
      return serializeOuter(node as never, { treeAdapter: defaultTreeAdapter });
    })
    .join("\n");

  return { html, bodyHtml, styleHtml, title, headings, sourceMap: serializeSourceMap(entries) };
}

/**
 * An HTML Page's title and Outline, without stamping or re-serializing it.
 *
 * `scanTree` needs a title for every Page it lists, and running the full ingest
 * over every `.html` file in a tree just to read its `<title>` would make a Nav
 * scan proportional to the cost of rendering. Skips source locations, which is
 * where most of that cost is.
 */
export function readHtmlMeta(source: string): HtmlMeta {
  return walkHtml(parse(source));
}

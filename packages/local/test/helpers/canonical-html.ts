import { parse, type DefaultTreeAdapterMap } from "parse5";

type Node = DefaultTreeAdapterMap["node"];
type ParentNode = DefaultTreeAdapterMap["parentNode"];

// The chrome's *rendered DOM*, written as an indented tree. Two templating
// mechanisms that produce the same document rarely produce the same bytes —
// `<meta charset>` vs `<meta charset/>`, `&#39;` vs `'`, indentation — so a
// byte-level golden would flag equivalent output as a change and stop being
// evidence of anything. Parsing both sides with the same HTML parser and
// serializing canonically compares what the browser actually builds.
//
// Attributes are sorted (source order carries no meaning), whitespace-only text
// nodes are dropped and internal runs collapsed (HTML folds them anyway outside
// `<pre>`; verbatim passthrough of content HTML is asserted separately).
export function canonicalHtml(html: string): string {
  const lines: string[] = [];
  walk(parse(html), 0, lines);
  return lines.join("\n") + "\n";
}

function walk(node: Node, depth: number, out: string[]): void {
  const pad = "  ".repeat(depth);

  if (node.nodeName === "#document") {
    for (const child of childrenOf(node)) walk(child, depth, out);
    return;
  }

  if (node.nodeName === "#documentType") {
    const doctype = node as DefaultTreeAdapterMap["documentType"];
    out.push(`${pad}!doctype ${doctype.name}`);
    return;
  }

  if (node.nodeName === "#text") {
    const text = (node as DefaultTreeAdapterMap["textNode"]).value.replace(/\s+/g, " ").trim();
    if (text) out.push(`${pad}"${text}"`);
    return;
  }

  if (node.nodeName === "#comment") {
    out.push(`${pad}<!-- ${(node as DefaultTreeAdapterMap["commentNode"]).data.trim()} -->`);
    return;
  }

  const element = node as DefaultTreeAdapterMap["element"];
  const attrs = [...element.attrs]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((a) => ` ${a.name}=${JSON.stringify(a.value)}`)
    .join("");
  out.push(`${pad}${element.tagName}${attrs}`);
  for (const child of childrenOf(element)) walk(child, depth + 1, out);
}

function childrenOf(node: Node): Node[] {
  return (node as ParentNode).childNodes ?? [];
}

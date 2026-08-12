// CSS scoping for a hoisted HTML Page's own stylesheet (ADR-0031 Amendments,
// issue #105). Local Preview hoists a Page's `<style>` content verbatim into
// the chrome's `<head>` (CONTEXT "Page") because there is no content frame
// locally; an ordinary `body { max-width: 40rem }` — routine Pandoc/Notion
// output — then restyles the chrome itself rather than the Page. We rewrite
// the stylesheet so it reaches only the Page's own content: everything is
// wrapped in `@scope (article) { … }`, and `html`/`body`/`:root` selectors —
// which otherwise match nothing, since the hoisted markup has no literal
// `<html>`/`<body>` inside the article — are retargeted to `:scope` so they
// land on the article box instead of silently vanishing.
import postcss, { type AtRule, type ChildNode } from "postcss";
import selectorParser from "postcss-selector-parser";

const SCOPE_ROOT_TAGS = new Set(["html", "body"]);
const KEYFRAMES_NAME = /^(-\w+-)?keyframes$/i;
const PREAMBLE_NAME = /^(import|charset)$/i;

function retargetSelector(selector: string): string {
  const transform = selectorParser((root) => {
    root.walk((node) => {
      if (node.type === "tag" && SCOPE_ROOT_TAGS.has(node.value.toLowerCase())) {
        node.replaceWith(selectorParser.pseudo({ value: ":scope" }));
      } else if (node.type === "pseudo" && node.value.toLowerCase() === ":root") {
        node.replaceWith(selectorParser.pseudo({ value: ":scope" }));
      }
    });
  });
  return transform.processSync(selector);
}

/**
 * Rewrites a Page's own stylesheet so it reaches its own content and stops
 * there, per the ADR-0031 amendment. Fails closed: malformed CSS (an ingest
 * boundary — the Source is whatever a Page's author or export tool wrote)
 * produces an empty stylesheet rather than emitting it unscoped, since an
 * unscoped rule reaching the chrome is exactly the bug this guards against.
 */
export function scopeToArticle(css: string): string {
  let root;
  try {
    root = postcss.parse(css);
  } catch {
    return "";
  }

  root.walkRules((rule) => {
    const parent = rule.parent;
    if (parent?.type === "atrule" && KEYFRAMES_NAME.test((parent as AtRule).name)) return;
    try {
      rule.selector = retargetSelector(rule.selector);
    } catch {
      rule.remove();
    }
  });

  // @import/@charset are only valid at the stylesheet's top level, so they
  // can't move inside the @scope block — they stay in a preamble ahead of it.
  const preamble: ChildNode[] = [];
  const scoped: ChildNode[] = [];
  for (const node of root.nodes) {
    if (node.type === "atrule" && PREAMBLE_NAME.test(node.name)) preamble.push(node);
    else scoped.push(node);
  }

  if (scoped.length === 0) return preamble.length ? postcss.root().append(preamble).toString() : "";

  const scope = postcss.atRule({ name: "scope", params: "(article)" });
  scope.append(scoped);
  return postcss.root().append(preamble).append(scope).toString();
}

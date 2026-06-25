import { visit } from "unist-util-visit";
import { toText } from "../util/text.js";

// Rehype plugin: rewrite ```mermaid fenced code blocks into <pre class="mermaid">
// holding the raw diagram source, so the client-side mermaid runtime renders
// them and Shiki leaves them alone. Must run BEFORE the Shiki transformer.
export function rehypeMermaid() {
  return (tree: any) => {
    visit(tree, "element", (node: any, _index, parent: any) => {
      if (node.tagName !== "code") return;
      const className = node.properties?.className;
      const classes = Array.isArray(className) ? className : [];
      if (!classes.includes("language-mermaid")) return;
      if (!parent || parent.type !== "element" || parent.tagName !== "pre") return;

      const source = toText(node);
      parent.properties = { ...(parent.properties ?? {}), className: ["mermaid"] };
      parent.children = [{ type: "text", value: source }];
    });
  };
}

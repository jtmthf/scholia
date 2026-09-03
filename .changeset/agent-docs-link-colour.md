---
"scholia": patch
---

Style links in the served Agent Docs. Its inline stylesheet had no `a` rule at all, so — because `rehype-autolink-headings` runs with `behavior: "wrap"` and the anchor _is_ the heading text — every heading on `/__agent-docs` and `/agent-docs` rendered in browser-default blue and underlined, reading as a page of links. Headings now take their own colour and body links take the oxblood accent (ADR-0016), with a visible focus ring.

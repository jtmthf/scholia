---
"scholia": patch
---

Prefactor for ADR-0039, no visible change: two layout tokens now say what actually renders.

`--layout-measure` becomes the pin — it fixes the article's text width directly — and
`--layout-content-width` becomes derived from it (measure + 2× the sheet's inline padding),
rather than the other way around. Previously `--layout-measure` was declared and read
nowhere, and the real 668px measure only coincidentally fell out of `--layout-content-width`
minus padding; nothing enforced it. Both values are unchanged at 668px / 780px.

`--rail-width` moves from `packages/ui/comments.css` into `@scholia/theme`, joining the
pinned layout table ADR-0039 reads from. `@scholia/ui` no longer declares a layout figure
(keeping with ADR-0030); Local Preview picks it up automatically via `@scholia/theme`, and
the hosted viewer — which doesn't depend on `@scholia/theme` — now supplies its own literal
`320px` copy in `packages/web/src/styles.css`, the same pattern it already uses for the
palette contract.

---
"scholia": patch
---

Fix an HTML Page's hoisted `<style>` restyling Local Preview's chrome instead of just its own content. Rules an author wrote against `body`/`html`/`:root` — ordinary output from Pandoc, a Notion export, a design spec — used to land on the real chrome document, since there is no `<body>`/`<html>` inside the hoisted `<article>` for them to match; a `body { max-width: 40rem }` collapsed the whole app to a 640px column and shrank the comment rail along with it. Hoisted rules are now wrapped in `@scope (article) { … }` and `body`/`html`/`:root` are retargeted to `:scope`, so a Page's styling reaches its own content and stops there (ADR-0031 amendment). `<link rel="stylesheet">`-referenced external CSS is unchanged — the bytes live in a file outside this pass's reach.

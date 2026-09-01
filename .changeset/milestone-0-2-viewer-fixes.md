---
"scholia": patch
---

Fix four rail and chrome affordances that showed the wrong state, or none.

- **Search snippets read as prose, not markdown** — a Markdown Page is indexed by the text a reader sees (a new `markdownText`, the counterpart to `renderedText` for HTML Pages), so a hit no longer shows `# Anchor` or `[ADR-0002](./…)`, and a query that straddles a marker now matches. (#116)
- **The theme toggle says which theme it is in** — one glyph and one label per theme, swapped by CSS off the same class the pre-paint script sets, plus `aria-pressed`. (#114)
- **The "This Page changed" notice moved off the Nav and gained a dismiss** — bottom-centre over the reading column, and dismissing it leaves the held update exactly where it was, to land by itself once composing ends. (#113)
- **A resolved Conversation folds both ways** — the one-way "N Comments — show" text is a styled, keyboard-reachable `<details>` disclosure, so it closes again and still works with JavaScript off. (#117)

Also: **the hosted viewer no longer server-renders comment controls that do nothing.** A hosted write needs an API Token and a client-minted Viewer, both of which only exist in the browser, so the server render supplies a port that can only read and the controls arrive at hydration instead of sitting there inert (ADR-0038, #111). `CommentsPort.addComment` and `Rail`'s `onNewPageComment` are optional for it, on the port's existing "an absent method is a surface the consumer doesn't have" rule.

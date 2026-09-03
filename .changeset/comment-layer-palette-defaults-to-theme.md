---
"scholia": patch
---

The comment layer's palette defaults to `@scholia/theme` (ADR-0041). `@scholia/ui`'s eight
generic variables (`--bg`, `--fg`, `--nav-*`, …) become fifteen `--scholia-comment-*` ones,
each falling back to an editorial token, so a consumer that imports only the theme renders
correctly and Local Preview no longer restates the palette by hand.

Fixes Local Preview's rail taking its badge, chip and button colours from the OS
`prefers-color-scheme` rather than the reader's own light/dark toggle — in light mode on a
dark-preferring machine, the whole rail was drawn in dark-mode accents.

The rail's five unrelated accents become three hues and ink: oxblood for what makes
something public (Comment, Reply, Promote), ink for the agent and private Chats, crimson
for Delete, ochre for Outdated. `--color-danger` and `--color-warning` join the theme's
tokens.

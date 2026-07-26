# Scholia's documentation is rendered by Scholia

## Status

accepted

## Context & Decision

`scholia.live` is registered and unbuilt. The obvious options were a docs framework
(fumadocs) or a general site framework (Astro).

**Scholia renders its own documentation**, via the `scholia build` static-export path.

The positioning argument is decisive: **ADR-0017 names fumadocs, by name, as the thing
Scholia structurally beats** — "'Open in editor' is therefore the one affordance that is
structurally unavailable to fumadocs and its peers, and the clearest expression of why the
local tool exists." Publishing Scholia's own documentation on fumadocs would say, publicly
and permanently, that we reached for a competitor when it was our own docs at stake. It
would also drag Next.js into the repo for a single surface.

It also gives `scholia build` a deadline. The export path has been recorded as a "future
direction" since mdttp and would otherwise never be prioritised.

Marketing, pricing and an eventual dashboard are **not being decided now** — there is
nothing to build yet. ADR-0011's revisit trigger (a framework may enter at the
route-and-load-heavy boundary, behind the iframe seam, without disturbing the viewer or the
CLI) still stands for when there is.

## Consequences

- **We ship a worse docs site for a while.** Search, versioning, API blocks and polished
  navigation are what a docs framework gives you today; Scholia's chrome is a Local Preview
  shell recently rebuilt on `@scholia/theme`. This is accepted deliberately: every
  deficiency in our own docs site is a deficiency our users have, and dogfooding converts
  complaints about the docs into a prioritised product backlog.
- If the answer turns out to be "Scholia is not good enough to document Scholia," that is
  the most important fact on the roadmap and we learn it in week two rather than year two.
- The docs deploy depends on our own build staying green. The coupling is the point.
- Sequenced after Conversations ship — docs built before then would document a markdown
  previewer, which is not the product.

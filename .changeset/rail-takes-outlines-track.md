---
"scholia": patch
---

The Rail takes the Outline's track (ADR-0039, issues #157/#158/#159). Local Preview's four
fixed-width columns needed 1748px — wider than any common laptop — to hold Nav, the sheet,
Outline and Rail at once. The Rail now substitutes for the Outline's track instead of adding
a fourth: Outline yields first, then Nav, then (below 1188px) the Rail leaves the column and
stacks under the article, mirroring the mobile shape below 720px. The reading measure never
drops below 780px above the mobile breakpoint at any width in between.

`--layout-measure` (668px) is now the pinned token and `--layout-content-width` (780px) is
derived from it; `--rail-width` moves from `@scholia/ui`'s `comments.css` into
`@scholia/theme`, with consumers (Local Preview, `@scholia/web`) supplying it.

`#scholia-comments` is now mounted unconditionally on every Page; `body.has-conversations`
(true only when the Page has at least one Conversation) replaces `body.has-comments` as the
grid-track trigger, and live reload now syncs that class explicitly so an agent's first
Comment on an open, un-commented Page brings the Rail's column in without a manual refresh.

Known follow-up, not fixed here: on an un-commented Page with Nav shown at a wide viewport,
`#scholia-comments` has no explicit grid track and CSS auto-placement drops it into a new
implicit row rather than costing the article any width — a stray strip beneath the Page,
not a stolen column. Left alone for now: every attempt to give it an explicit placement
instead broke one of the composer flows that still need to work with zero Conversations
(the rail-toolbar's page-level composer, or a text selection's floating Comment/Ask
buttons), so it's tracked as a follow-up rather than solved under this PR.

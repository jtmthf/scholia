# The Rail takes the Outline's track, and the measure is never the variable

## Status

accepted

Decides what [ADR-0016](./0016-editorial-visual-identity.md) left undecided: it pinned a
**three**-column grid and said nothing about a comment surface, so when the Rail arrived it
became a fourth fixed column with no decision behind it. Takes the intermediate-layout work
that [issue #112](https://github.com/jtmthf/scholia/issues/112) deferred to
[#61](https://github.com/jtmthf/scholia/issues/61) but that #61's acceptance criteria never
picked up. Constrained by
[ADR-0031](./0031-local-preview-renders-page-content-in-the-chrome-document.md) (the Rail is
the page's only hydration boundary), [ADR-0028](./0028-local-preview-navigates-by-swap.md)
(navigation replaces chrome elements in place) and
[ADR-0030](./0030-shared-comment-layer-as-its-own-package.md) (what `@scholia/ui` may know).

## Context & Decision

ADR-0016 pinned Nav at 260px, content at 780px, the Outline at 220px and the gap at 40px.
The Rail was added afterwards at a fixed 320px, and content was left as the only flexible
track — so every fixed column was paid for out of the reading column. Measured on the
current code:

| Viewport | Computed grid               | Article | Overflow           |
| -------- | --------------------------- | ------- | ------------------ |
| 1512     | `260 544 220 320`           | 544px   | none               |
| 1280     | `260 464 220 320`           | 464px   | `scrollWidth` 1408 |
| 1100     | `260 464 220 320`           | 464px   | `scrollWidth` 1408 |
| 1000     | `260 464 320` (Outline out) | 464px   | `scrollWidth` 1148 |

At 1280 the Rail is clipped mid-word — the Conversations, which are the reason the page
exists, are what breaks. `app.css` admits this in a comment and defers to #61, and #61 is
scoped to user-invoked toggles, so nothing owned it.

The decisive arithmetic is that **four columns need 1748px**. No common laptop is that wide,
so this was never a question of degrading gracefully near the edges: the arrangement is not
viable on the machines the product is developed and read on, and something replaces it.

### The measure is the constraint, and it is arithmetic

`--layout-measure: 668px` is declared in `packages/theme/tokens.css` and used **nowhere** —
`grep` returns its own declaration and nothing else. The real measure emerges instead from
`--layout-content-width: 780px` minus twice the 56px sheet padding, which happens to equal 668. So the number ADR-0016 pinned is the one nobody enforces, and the number enforced is a
coincidence. That is why the measure could silently become ~48 characters (#112) without any
test or token noticing.

**We invert it.** The measure becomes the pin: the sheet's text width is set from
`--layout-measure`, and `--layout-content-width` becomes derived as measure + 2× inline
padding. "Honour the measure" then means exactly **content track ≥ 780px**, which is
checkable.

### Nav and the Outline yield; the Rail yields last

We did not invent a priority. CONTEXT's **Focus** already says it: _"a reading state in
which Nav and Outline are both collapsed, leaving the Page and its Conversations. Nav and
Outline are each independently dismissible."_ The domain language had already decided that
the Conversations are what a reader is there for. #112 reached the same order independently
("drop the Outline first"). So: **Outline, then Nav, then the Rail.**

### The Rail takes the Outline's track rather than adding a fourth

The Outline is 220px and the Rail is 320px, so substituting costs 100px where adding costs 360. That moves the requirement from 1748 to **1488**, which fits a 1512 laptop with Nav
intact, and it collapses the threshold table to one number people can hold.

It also removes a bad interaction. Because an un-commented Page has no Rail track (below),
Nav + sheet + Outline needs only 1388px — so at 1512 all three panes fit. Adding a fourth
column would mean **posting the first Comment made the Outline disappear**, a 360px jump
caused by writing a Comment. Substitution makes it 100px, and makes it the ordering above
expressed as geometry rather than as a cascade of breakpoints.

| Viewport    | Arrangement                                                    |
| ----------- | -------------------------------------------------------------- |
| ≥ 1748      | Nav + sheet + Outline + Rail                                   |
| 1440 – 1748 | Nav + sheet + Rail (page gutters drop below 1488 to hold 1440) |
| 1188 – 1440 | sheet + Rail                                                   |
| 828 – 1188  | sheet, Rail as an overlay                                      |
| < 720       | existing mobile behaviour, unchanged                           |

Because the Outline (220) is cheaper than Nav (260) beside the Rail, roughly 1400–1488 is a
band where the reader can have **either** pane but not both. That is a real choice rather
than a refusal, and it is why the toggles stay live there.

### The element is always mounted; only the track is conditional

An empty Rail currently costs the reading column 360px on every Page — it holds a composer
and the words "No Conversations yet" whether or not anything is in it, because
`comments` is non-null whenever the Page rendered at all and `null` only on a render error.

The obvious fix — render no Rail when there are no Conversations — breaks live reload.
`main.ts` swaps with `if (next && prev) prev.replaceWith(next)`, so it **cannot make an
element appear**: an agent writing the first Comment on a Page would not reach an open
preview, which is one of the reasons CLAUDE.md gives for two writers being useful at all.

So we separate the two questions. **`#scholia-comments` is always mounted** — ADR-0031
unchanged, hydration boundary stable, live-reload target intact — and what is conditional is
the **grid track**, keyed on a new `body.has-conversations` in place of today's
`has-comments`. An un-commented Page pays nothing and can still receive the first Comment.

### Below 1188 the Rail leaves the flow

At that width the Rail cannot be a column without breaking the measure, so it becomes an
overlay following the pattern already in the codebase for narrow-viewport Nav
(`.nav-backdrop`, `body.nav-open`): fixed surface, backdrop, Esc and backdrop-click to
dismiss, focus trapped while open, keeping its own scroll.

Its primary opener is **clicking the annotated passage**, which `@scholia/bridge`'s parent
port already reports ("called on every click in the content: `id` is the highlight hit, or
null"), with a topbar control as the discoverable fallback.

This is why an overlay is right narrow and wrong wide, and the distinction is worth stating
because otherwise the next reader sees two mechanisms and assumes one is legacy: **a Rail
covering prose is a defeat when you were reading that prose, and fine when you deliberately
tapped it to ask what is said about it.** Anchoring is the product's premise, so at widths
where a column fits, a column is what we use.

### Who dismisses what, and what gets announced

A viewport change is not the reader's action, so it takes a pane away **silently and
reversibly**: the reader's choice is held as standing intent and reasserts itself when width
returns. This is the same "remembers what was open" machinery Focus already requires, so
#61 builds it once and both callers use it.

A toggle **is** the reader's action, so its side effect is visible: enabling the Outline at
1512 costs Nav, and the control says so rather than silently reflowing.

Where a pane cannot fit at all — below ~1400 for either — its toggle is **disabled with a
reason** ("no room for the Outline at 1280px without breaking the 780px measure"). The
alternative is a control that lies. This means at 1280, with a Conversation present, there
is no arrangement in which Nav is visible; that is the measure outranking a request, made
legible.

One modelling trap, found in the prototype and recorded because #61 will meet it: the toggle
must flip **what the reader is currently seeing**, not the stored intent. Those agree until
the viewport has already taken a pane away, at which point flipping intent turns it further
off instead of asking for it back.

### Drift is prevented by testing the invariant, not the numbers

The bug being fixed here was pinned token widths and a hand-written grid disagreeing, and
CSS media queries cannot read custom properties — so any breakpoint is a hardcoded
restatement of the tokens that will drift again. We therefore assert the **promise**, in the
e2e suite: the content track is ≥ 780px at every width above the mobile breakpoint. The
breakpoints stay hardcoded in CSS with a comment pointing at that test, and are free to move
without a test rewrite.

`--rail-width: 320px` moves from `packages/ui/comments.css` into `@scholia/theme` and joins
the pinned decision table. Every threshold above is a function of it, and it was the one
figure in that table nobody could find — living in the package ADR-0030 deliberately keeps
free of layout knowledge, where it asserted a layout fact about two different consumers.

## Considered Options

- **Keep the Rail a column and let the reading column absorb the loss.** The status quo.
  Rejected: it produces a 464px article and a Rail clipped mid-word, and #112 already
  floored the column precisely because that is a defect at any viewport.
- **Make the Rail an overlay at every width.** One mechanism everywhere, and ADR-0016's
  pinned three columns never move. Rejected because a Rail that covers the prose it
  annotates defeats anchoring — reading a Conversation beside the sentence it is about is
  the product, and at 1512 there is room for it.
- **Translate the sheet when the Rail opens**, keeping 780px and shifting left, which is
  what the comparison product (Proof) does — measured at editor x=422 w=654 with no rail and
  x=260 w=654 with one. Rejected as a mirage here: Proof buys that translation with ~422px
  of slack margin at 1512, and Scholia's grid is `max-width: 1760` and fills, so there is no
  slack to translate into until Nav yields — which makes it this decision with extra
  animation.
- **Let the sheet go below the measure when a reader asks for all three panes.** Rejected:
  a measure that yields to any request is not a constraint, and unbounded growth in the
  other direction is exactly how the hosted Viewer reached 150-character lines.
- **Give the Rail the slack in Focus** (sheet + Rail at 1512 leaves 324px spare). Attractive
  and not foreclosed, but deferred: a Rail whose width varies by pane configuration makes
  the Conversation card a variable-width component across four arrangements, and the card's
  density work needs one target width.

## Consequences

- **The four-column arrangement stops being the reference width.** It renders where it fits
  (≥1748, i.e. an external monitor) but nothing is tuned for it, and on every common laptop
  the Outline is not present by default.
- **`--layout-measure` becomes load-bearing and `--layout-content-width` becomes derived.**
  ADR-0016's decision table still holds every figure; what changes is which of the two is
  the pin. The header comment in `tokens.css` needs to say so.
- **`body.has-comments` is replaced by `body.has-conversations`**, and both live reload and
  ADR-0028's navigate-by-swap must update it explicitly — the swap loop replaces named
  elements and never touches `<body>`'s classes, so a stale class here is the same family of
  bug as the one that forced the element/track split.
- **The hosted Viewer takes the measure and the Rail rule now.** It is flexbox with no
  content max-width at all, so it is currently the worse violation of the constraint this
  ADR makes law. It has **no Outline**, which stays a divergence from ADR-0016 and is
  tracked rather than deferred silently — ADR-0016 deferred a Viewer divergence from exactly
  this position and it is still open.
- **`@scholia/ui` stops declaring a layout figure.** Consumers supply `--rail-width` from the
  theme, which is the direction ADR-0030 already points.
- **#61 keeps its scope.** It owns the user-invoked toggles and Focus, and is blocked by the
  layout rule here rather than widened to carry it.
- **Reversing this** means re-pinning `--layout-content-width`, restoring the fourth column
  and dropping the invariant test. Cheap mechanically — but the reading measure is the whole
  claim of ADR-0016's editorial direction, and a surface that pays for its chrome out of the
  prose is the thing that identity was chosen to avoid.

## Prototype

The arrangement, the toggle interaction and the margin ties were settled against a working
prototype rather than on paper:
<https://claude.ai/code/artifact/c6840851-9e3b-41af-93cb-c5ef081d4acf>. It computes the
arrangement from the pinned figures with the same drop order described above, so the
threshold table can be checked rather than trusted.

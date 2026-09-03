# The comment layer's palette defaults to the theme, and the contract is namespaced

## Status

accepted

Amends [ADR-0030](./0030-shared-comment-layer-as-its-own-package.md), which said the
palette stays with the consumer, and settles the divergence
[ADR-0016](./0016-editorial-visual-identity.md) deferred for the comment surface
specifically. Closes [issue #75](https://github.com/jtmthf/scholia/issues/75) and unblocks
[#28](https://github.com/jtmthf/scholia/issues/28).

## Context & Decision

ADR-0030 gave `@scholia/ui` no palette of its own. `comments.css` resolved every colour
through eight variables — `--bg --fg --muted --border --chrome-bg --nav-hover
--nav-active-bg --nav-active-fg` — that the surrounding surface was expected to supply,
and named that contract in a comment at the top of the file. Exactly one consumer answered
it: `packages/web/src/styles.css`, with a Primer-ish palette. `@scholia/theme` — the
package that exists to hold the visual identity — defined a different set of names
entirely (`--color-paper`, `--color-ink`, `--color-accent`, `--color-rule`,
`--color-surface`, `--color-muted`).

So the second consumer had to invent the mapping, and it did. `packages/local`'s `app.css`
carried a hand-written block answering all eight in `@scholia/theme`'s terms, plus a second
block restating ten of the comment layer's internal colours under `html.dark` — because
`comments.css` switched scheme on `prefers-color-scheme` while Local Preview switches on a
class the reader toggles. Those two mechanisms do not compose: a reader in Local Preview's
**light** mode on a dark-preferring OS got the comment layer's **dark** badges, chips and
buttons, and nothing in the codebase could have said so.

Three symptoms of one cause, and the cause is that a contract with no shared source is
answered by whoever needs it, differently each time:

- **The mapping is copied, not shared.** A ninth name added to `comments.css` reaches the
  hosted viewer and silently resolves to nothing in Local Preview.
- **The names are generic.** `--bg` and `--fg` are what any surrounding surface calls its
  own colours, so answering the contract and styling the page are the same act, and a
  consumer cannot tell which of its variables `@scholia/ui` is reading.
- **The layer states its own colours anyway.** Six hues were hard-coded in `comments.css`
  below the contract — a purple agent badge, a blue primary button, two different reds,
  an ochre — so the "the consumer supplies the palette" claim was only ever true of the
  greys. The 0.2 QA pass found the consequence: five unrelated accents in one rail, none of
  them from the editorial palette they sat on.

### The theme is the default, not the requirement

`@scholia/ui` keeps its runtime dependency on `preact` and nothing else — it does not
`@import` the theme, and a consumer still decides where the stylesheet lands. What changes
is that **every colour now has a default, and the default is a `@scholia/theme` token**.
A consumer that imports the theme and `comments.css` renders correctly with no palette of
its own, which is the property Local Preview needed and could not get.

This is where ADR-0016 already pointed ("the hosted Viewer is now committed to follow") and
it costs the hosted viewer nothing yet, because a consumer with a palette of its own can
still answer the contract — which is what `packages/web/src/styles.css` now does, in one
block, explicitly labelled as the divergence.

### The contract is namespaced, and read exactly once

The eight generic names become fifteen `--scholia-comment-*` ones, split into a **surface**
half (`-bg -fg -muted -border -chrome-bg -hover -accent -accent-bg -accent-fg`) and a
**roles** half (`-agent -agent-fg -danger -danger-fg -warning -warning-bg`). Every rule in
the file resolves through a private `--sc-*` alias, and each public name is read exactly
once, in the `:root` block, with its theme token as the fallback:

```css
--sc-accent: var(--scholia-comment-accent, var(--color-accent));
```

The indirection is the point. A plain default — declaring `--scholia-comment-accent` in
`comments.css` — would lose to whichever `:root` the cascade saw last, so whether a
consumer's override worked would depend on the order it imported two stylesheets in. The
hosted viewer imports `styles.css` _before_ `comments.css`, so under a plain default the
override would have lost. Reading the public name through an alias makes the override win
whatever the order, because substitution happens at use.

### The layer states no scheme of its own

The `@media (prefers-color-scheme: dark)` block is gone from `comments.css`. Light and dark
now come from wherever the contract is answered — the theme switches on `html.dark`, the
hosted viewer on `prefers-color-scheme` — so the layer inherits the surrounding surface's
scheme mechanism instead of asserting a second one beside it. That is what fixes the
light-mode-on-a-dark-OS bug, and it is why Local Preview's `html.dark` restatement block
could be deleted rather than corrected.

### Two status hues move into the theme

`--color-danger` (`#a8144a` / `#ff6b9d`) and `--color-warning` (`#9a6700` / `#d29922`) join
`tokens.css`. Neither is new: the crimson is the one ADR-0016 already chose for Caution
precisely because `#cf222e` sat close enough to the oxblood accent to read as a link, and
the ochre is the existing Warning alert. Naming them is what lets a destructive control and
an Outdated Conversation state a hue once instead of each restating a hex, and it is the
"somewhere to state them" the QA finding on #75 asked for.

The editorial defaults that follow reduce the rail from five unrelated accents to three
hues and ink:

- **Oxblood** for anything that makes something public — Comment, Reply, Submit, and
  Promotion. Rubrication reaching the marginal surface the product is named for, which
  ADR-0039 had already given the Outline's track.
- **Ink** for the agent and private Chats: the agent badge, "Ask", the Chats section, a
  Chat card's border. A private Chat is written in ink and a public Comment in rubric,
  which is a distinction the rail can carry without a fifth hue.
- **Crimson** for Delete and the Owner tier, **ochre** for Outdated.

Promotion is the one control inside a Chat that wears the public accent rather than the ink
the card around it is drawn in. That is not decoration: with ink, Promote and Resolve are
two grey outlines side by side and the affirmative action is indistinguishable from the
neutral one — visible in the dark scheme in particular, which is where it was caught.

## Considered Options

Issue #75 named three; they are not alternatives so much as increasing amounts of the same
move, and the decision takes two of them.

- **A documented adapter block in `@scholia/theme`** mapping its tokens onto the eight
  existing names, imported by any consumer. Rejected on its own: it keeps `--bg` and `--fg`
  as the public contract, so the collision with the consumer's own names stays, and it adds
  a file whose only job is to survive being forgotten.
- **Rewrite `comments.css` against the editorial tokens outright**, hosted viewer included.
  Rejected as scoped here, not on the merits: it restyles the hosted rail before the chrome
  around it moves, which produces an oxblood rail on a Primer-grey page. The hosted
  viewer's adoption is a decision about the whole surface and stays open (#162 is its
  nearest tracked piece).
- **Rename to `--scholia-comment-*` with theme-token defaults.** Taken, and extended: the
  rename alone would have left the six hard-coded hues, which are most of what made the two
  palettes diverge.
- **Keep `prefers-color-scheme` in `comments.css` and have Local Preview restate the dark
  values**, which is the status quo. Rejected: it is the bug, and every name added later
  has to remember to be restated.

## Consequences

- **The hosted viewer's palette is one deletable block.** `styles.css` answers all fifteen
  names; `versioning.css` and `owner-panel.css` stop reaching into `@scholia/ui`'s
  internals (`--outdated-label-fg`, `--floating-btn-bg`) and read the contract or the
  viewer's own variables instead. When the viewer adopts `@scholia/theme`, that block goes
  and the editorial defaults take over.
- **Five hosted affordances change appearance, and the other 78 of 83 comment-layer classes do not.**
  Measured by rendering every class in `comments.css` under the old and new stylesheets and
  diffing computed `color` / `background-color` / `border-color` in both schemes, resting
  and hovered. Every change is a duplicated hue collapsing onto one contract name, not a
  retheming:
  - `.thread-action-btn--promote` goes from purple (`#8250df` / `#a371f7`) to the viewer's
    accent (`#0969da` / `#58a6ff`) — Promotion is a public act, per the decision above.
  - `.btn-danger` and `.thread-action-btn--delete` take the Owner-tier red (`#cf222e`
    light, `#ff7b72` dark) in place of `#c0392b`, which was a single light-mode value used
    unadjusted in both schemes.
  - `.reaction-chip--mine` takes the accent wash (`#dce4ed` ground, `#0969da` border and
    text) in place of its own pale blue (`#ddf4ff` / `#54aeff` / `#0550ae`), matching the
    resolved badge, which already used that wash.
  - In **dark only**, text on a solid ground takes the scheme's own counterpart rather
    than a pinned white. `.btn-primary` and `.floating-action-btn` become the nav accent
    (`#58a6ff`) with dark text instead of `#1f6feb` with white — the viewer had two blues
    for one role — and `.floating-ask-btn` keeps its purple but takes dark text. Both are
    also the more legible: 7.2:1 against 4.6:1, and 5.5:1 against a failing 3.3:1.
  - Their hovers follow, since hover is now derived from the accent
    (`color-mix(accent 85%, fg)`) rather than pinned to a second literal.
    Everything else — the agent badge, "Ask", the Chats section, private cards, Outdated
    labels, and every grey — is byte-identical.
- **Local Preview restates nothing**, and its rail follows the theme toggle, which it did
  not before.
- **The contract is tested as text, not as pixels.** `packages/ui/test/palette.test.ts`
  asserts that every colour resolves given only `@scholia/theme`, that every overridable
  name is in the namespace, that the header table matches the names actually used, and that
  no hex literal survives below the defaults block; `packages/web/test/palette.test.ts`
  asserts the hosted answer stays complete in both schemes. None of that needs a browser,
  so it runs in the same Node setup as the rest of the workspace.
- **`@scholia/ui` gains `@scholia/theme` as a devDependency**, so the contract test can
  resolve `tokens.css`. The runtime dependency stays `preact` alone, which is the
  constraint ADR-0030 exists to protect.
- **Reversing this** means restoring the eight generic names and the hard-coded hues, and
  re-inventing the mapping in every consumer. The rename is mechanical; what would be lost
  is that a second consumer can no longer get the palette wrong silently.

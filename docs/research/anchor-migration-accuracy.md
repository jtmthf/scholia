# Anchor migration accuracy against real agent edits

Spike for [issue #24](https://github.com/jtmthf/scholia/issues/24). Investigation
only — no production code changed.

**Corpus:** `packages/core/test/fixtures/anchor-migration/` — 41 revisions of six
of this repo's own prose docs, pulled from git history (this repo is agent-built,
so consecutive revisions are real agent rewrites), plus 42 hand-labelled
single-step Anchor cases and 12 chain cases.

**Harness:** `packages/core/prototype-anchor-migration/` (throwaway).
`tsx packages/core/prototype-anchor-migration/tui.ts` /
`tsx packages/core/prototype-anchor-migration/report.ts`.

## Headline

|                              | correctly followed | correctly Outdated | **wrongly Outdated** | **wrongly re-anchored** |
| ---------------------------- | ------------------ | ------------------ | -------------------- | ----------------------- |
| single step, rendered (n=41) | 16 (39%)           | 13 (32%)           | **12 (29%)**         | **0**                   |
| single step, source (n=42)   | 12 (29%)           | 18 (43%)           | **12 (29%)**         | **0**                   |
| whole chain, rendered (n=10) | 3                  | 2                  | **5 (50%)**          | **0**                   |
| whole chain, source (n=12)   | 2                  | 4                  | **6 (50%)**          | **0**                   |

The two failure modes did not come out balanced. **Wrongly re-anchored never
happened — not once in 106 measured migrations.** Wrongly Outdated happened in
29% of single steps and 50% of Anchors carried across a document's full history.

Migration fails safe, hard. The design worry that an Anchor might silently
re-attach to text that is no longer what the comment meant did not materialise;
the worry that should replace it is that Outdated fires so often it stops
carrying information.

## Every wrongly-Outdated case has the same cause

All 12, in both layers, are `context-broken`: **the exact quoted text is still
present in the new Version, still unique, and the migration failed anyway**
because the stored prefix/suffix no longer match.

This is not incidental. The iframe's `buildUniqueQuote`
(`packages/bridge/src/iframe/entry.ts`) attaches 32 characters of context on
_every_ capture — including when `exact` is already unique in the document, where
it is explicitly labelled "unique by exact text alone — still include context for
resilience." `searchQuote` (`packages/core/src/anchor/quote.ts`) then treats that
context as **mandatory**, requiring a literal `endsWith`/`startsWith` match. So
context that was captured as belt-and-braces resilience is, in practice, the only
thing that ever breaks.

Concretely, these all went Outdated with their text untouched:

- a heading whose section body was rewritten around it (`## Quick start`,
  `## 1. Trim the surface`, `## Running the hosted-path tests (the trap)`)
- a sentence one line above a renamed env var (`COLLAB_HOSTED` → `SCHOLIA_HOSTED`)
- a line in a code fence that had two lines inserted after it
- a definition that was byte-identical but had a new entry inserted below it

Every category's worst performer is the same shape. `moved-paragraph` scored
**0/2** — a paragraph that moves verbatim always takes its context with it.

## Incremental re-anchoring is a no-op, and provably so

Issue #24 asks whether emitting a `reanchored` event per successful migration
beats always re-resolving from the original quote. Measured over the chain cases:
**the two strategies produced identical results on every case, in both layers.**

The reason is structural, not a property of this corpus. A successful
`searchQuote` means the stored prefix and suffix are already literal substrings of
the new text at the matched position. Re-expanding context there therefore
reproduces the same quote. The harness measures this directly rather than
assuming it: across **56 successful migrations, re-capture produced a different
quote 0 times.**

Incremental re-anchoring only becomes a meaningful choice under _tolerant_
matching, where a successful match can land on text that differs from the stored
quote. And there it is the dangerous direction — it is precisely the mechanism by
which an Anchor walks away from what the comment meant, one small approved step
at a time. **Don't build it.** There is nothing for it to fix today, and the
conditions that would give it something to fix are the conditions under which it
becomes a liability.

## Characterising the dangerous class

Zero instances, so the class is characterised by its preconditions instead. A
wrong re-anchor under literal matching needs the quote to resolve uniquely at a
location that is not the corresponding one — which needs duplicated text.
Measured over **every** plausible anchor position in the corpus (every line ≥24
characters in every revision), not just the labelled cases:

- **0 of 4,739** rendered positions / **0 of 4,990** source positions produce a
  quote that fails to resolve uniquely in the very document it was captured from.
- **0** lines of ≥24 characters appear more than once within any single document.

There is no decoy material in prose docs. Uniqueness-by-construction plus
mandatory literal context means a wrong landing would require a decoy to
reproduce roughly 64 characters of surrounding text verbatim.

One real code path can still produce it, and should be closed regardless of
anything else here. `buildUniqueQuote` gives up at `MAX_CONTEXT = 200` and
**returns a best-effort quote even when that quote is still ambiguous, with no
signal to the caller**. An Anchor born that way is broken on arrival — it is
Outdated immediately, and if a later Version deletes all but one occurrence it
silently adopts whichever copy survived. This corpus never triggers it (0/9,729
positions), but a document with repeated boilerplate — generated API tables,
changelogs, licence blocks — would. That is the shape to watch, and it is cheap
to detect at capture time.

## Recommendation

### Matching

**Fall back to `exact` alone when context fails, gated on `exact` resolving
uniquely in the new Version.** Measured against the corpus, this:

- rescues **12 of 12** wrongly-Outdated cases, in both layers
- breaks **0 of 13** correctly-Outdated cases — an Anchor that _should_ go
  Outdated had its text genuinely deleted, so an exact-only retry does not
  resurrect it either

That takes the corpus from 71% correct to 100% correct with no measured cost.
The uniqueness gate is what keeps the dangerous class shut, and it is the same
guarantee ADR-0002 already rests on.

**Do not adopt fuzzy or similarity-threshold matching, and so do not pick a
threshold.** The 29% wrongly-Outdated rate looks like a case for approximate
matching, but the entire measured failure is context-only — no approximate
matching is needed to fix it, and introducing a threshold would manufacture the
one failure class that currently has zero instances. This is the ADR-0002
position ("anchoring wrong is worse than an honest 'this moved'") holding up
under measurement: keep matching literal, and relax what is _required_ to match
rather than how closely it must match.

**Make capture-time ambiguity an error, not a silent best effort.**
`buildUniqueQuote` exhausting `MAX_CONTEXT` should be reported, not swallowed.

### The local path specifically

Issue #24 expected the local, live-file path to behave differently because edits
arrive continuously against smaller changes. It does — but the difference is the
_layer_, not the frequency. Source-layer and rendered-layer wrongly-Outdated
rates are identical (12 and 12), yet they disagree on which Anchors survive: a
plain `oxfmt` run (`*x*` → `_x_`, `context` v4→v5) leaves the rendered text
byte-identical while changing the source bytes. **Anchors re-resolved against
live markdown source will go Outdated on formatter runs that a reader would never
even see.** If local re-resolution matches source rather than rendered output,
running the formatter silently outdates comments.

### What the UI must disclose

The measurements say Outdated is common (29% per edit, 50% over a document's
life) and almost always means "this moved," not "this changed." The UI has to
carry that, or readers will learn to ignore the rail.

- **Distinguish "the text is still there, its surroundings changed" from "the text
  is gone."** The harness already computes this attribution (`context-broken` vs
  `exact-missing`) and it is the difference between a one-click recovery and a
  genuine loss. Today both render as the same Outdated state.
- **Offer the re-attach.** When `exact` is still uniquely present, show where it
  now is and let the reader confirm. This is the same fallback as above, surfaced
  rather than automatic, and is the honest UI even if the matching change ships.
- **Never present a migrated Anchor as certain when it was not literal.** Nothing
  today is non-literal, and that property is worth stating in the UI contract so
  it is a deliberate decision to break it later.
- **Say what changed.** Outdated already retains the original quote (CONTEXT.md);
  pairing it with the source-level Diff for that Version is what makes "this
  moved" checkable.

## Limits of this corpus

Six hand-picked prose documents from one repo, all markdown, all written by the
same small set of agents, 42 hand-labelled cases. The zero-decoy result in
particular is a property of prose and would not survive contact with generated
reference docs. Ground-truth labels are mine and are argued in `cases.json`'s
`note` fields precisely so they can be disputed; the strategy-equivalence and
born-ambiguous results do not depend on them.

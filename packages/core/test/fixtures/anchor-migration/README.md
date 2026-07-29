# Anchor migration corpus

Real before/after document pairs from actual agent rewrites, with hand-labelled
ground truth for what each Anchor *should* do. Built for issue #24; kept as a
reusable fixture.

## Where it comes from

`chains/` holds consecutive distinct revisions of six of this repo's own prose
docs, oldest first, extracted from git history. This repo was built by agents, so
consecutive revisions of its docs are real agent rewrites — not edits authored to
make a point.

| chain          | doc               | revisions |
| -------------- | ----------------- | --------- |
| `context`      | `CONTEXT.md`      | 6         |
| `agents`       | `AGENTS.md`       | 10        |
| `readme`       | `README.md`       | 8         |
| `contributing` | `CONTRIBUTING.md` | 6         |
| `plan`         | `PLAN.md`         | 4         |
| `launch`       | `LAUNCH.md`       | 7         |

`chains/chains.json` records the commit, date and subject behind each revision.
Regenerate with `pnpm prototype:anchors:extract` (idempotent; it deduplicates the
PR-merge commits that carry an identical blob).

## The labels

`cases.json` has two kinds of entry.

**`cases`** — single-step: one Anchor, one before/after pair, one hand-written
verdict. `expect` is `"follow"` when a human would say the text merely moved, and
`"outdated"` when the text it pointed at is genuinely gone or changed meaning.
`note` records the reasoning so a label can be argued with.

**`chainCases`** — one Anchor captured at v1 and carried down the whole chain,
labelled only at the final revision. These are what distinguish migration
strategies, since a strategy that re-captures state can only diverge on a second
or later hop.

Two fields exist because of a real asymmetry. `renderedSelection` gives the same
span as it appears after rendering (markdown markup stripped). `expectSource` /
`expectRendered` override the verdict per layer — a formatter run (`*x*` → `_x_`)
changes the source bytes while leaving the rendered text byte-identical, so the
honest answer genuinely differs between the two.

## Categories

`reworded-sentence`, `moved-paragraph`, `split-or-merged-sections`,
`renamed-heading`, `wholesale-rewrite`.

## Using it

The measurement harness is a prototype and is throwaway:
`packages/core/prototype-anchor-migration/`. The corpus is not — it is a fixture
any future anchoring change can be measured against.

```sh
pnpm prototype:anchors          # interactive scoreboard + case stepper
pnpm prototype:anchors:report   # the full tally, non-interactive
```

Findings live in [`docs/research/anchor-migration-accuracy.md`](../../../../../docs/research/anchor-migration-accuracy.md).

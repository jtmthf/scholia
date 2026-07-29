# PROTOTYPE — anchor migration accuracy (issue #24)

**Throwaway.** Not production code, not tested, not shipped. Delete after the
question is answered; the corpus it produces is the keeper.

## The question

When an agent rewrites a document, what actually happens to the text-quote
Anchors pointing into it?

`migrateAnchor` (`packages/core/src/anchor/migrate.ts`) re-resolves an Anchor's
text-quote against a new Version and marks it **Outdated** on anything other than
a unique match. `searchQuote` matches by literal `indexOf` plus strict
`endsWith`/`startsWith` on prefix/suffix context, so the algorithm can essentially
only fail _toward_ Outdated. Two failure modes matter and pull opposite ways:

- **wrongly Outdated** — a human would say the text merely moved. Noisy, visible.
- **wrongly re-anchored** — the quote re-attached to text that is no longer what
  the comment meant. Rare under literal matching, but invisible, and worse.

The spike measures both over real agent rewrites, and answers whether
**incremental re-anchoring** (re-capture the quote against each new Version on a
successful migration) beats **always re-resolving from the original quote**.
Under today's code those two are _identical_ — `migrateAnchor` keeps the original
`textQuote` verbatim on success — so the comparison only becomes real once
incremental re-expands its context. That re-expansion is what `expand.ts`
provides.

## What is portable vs. throwaway

| File                | Fate                                                                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expand.ts`         | **Portable.** Pure `expandToUnique` — the server-side counterpart to the iframe's `buildUniqueQuote`, which today exists only in DOM code. Lifts to `packages/core/src/anchor/expand.ts`. |
| `strategies.ts`     | **Portable.** The two migration strategies as pure functions.                                                                                                                             |
| `measure.ts`        | **Portable-ish.** Pure corpus → tally. Useful as a regression harness.                                                                                                                    |
| `extract-corpus.ts` | Throwaway. git history → fixture files.                                                                                                                                                   |
| `verify-corpus.ts`  | Throwaway. Asserts every fixture revision is still its git blob byte for byte.                                                                                                            |
| `report.ts`         | Throwaway. Non-interactive dump of the whole tally.                                                                                                                                       |
| `tui.ts`            | Throwaway. The terminal shell.                                                                                                                                                            |

## Run it

```sh
pnpm prototype:anchors          # interactive: scoreboard, case stepper, chain view
pnpm prototype:anchors:report   # the full tally, non-interactive
```

Corpus lives in `packages/core/test/fixtures/anchor-migration/` and is committed
(issue #24 asks for it as a reusable fixture). Regenerate the document chains, and
check they have not drifted, with:

```sh
pnpm prototype:anchors:extract
pnpm prototype:anchors:verify
```

`.prettierignore` covers `packages/*/test/fixtures/`, so `pnpm format` leaves the
corpus alone — `verify-corpus.ts` is what proves that stayed true.

## Findings

[`docs/research/anchor-migration-accuracy.md`](../../../docs/research/anchor-migration-accuracy.md)

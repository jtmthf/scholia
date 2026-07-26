# ADR-0025: TypeScript 7 for typechecking, and no monorepo task runner yet

- Status: Accepted
- Date: 2026-07-26

## Context

The workspace is 11 packages heading for ~15, with one publishable artifact.
`typecheck` is a single root `tsc` invocation. Issue #17 asked two questions that
are really one pipeline: should a monorepo task runner orchestrate the workspace,
and what settles the typecheck story?

TypeScript project references were **rejected up front** as duplicative of
`package.json` — the dependency graph would be maintained twice and would drift.
That left two live routes for typecheck:

- (a) let a tool derive references from `package.json` (Nx and Moon both do), or
- (b) confirm the native TypeScript compiler is stable enough that a single root
  `tsconfig.json` stays fine.

Candidates were trialled on branches against this codebase (183 TS/TSX files)
rather than compared on a feature table, following the precedent ADR-0024 set for
oxlint vs Biome. `pnpm trial` on `prototype/task-runner-trial` is the harness;
`PROTOTYPE-FINDINGS.md` on that branch is the long-form record.

## Trial results

Median wall clock, Apple M2, 8 cores. `cold` = all caches cleared. `warm` =
re-run with nothing changed. `inc` = one real content edit to
`packages/core/src/index.ts`, the leaf seven packages depend on.

Whole pipeline (typecheck + test + build):

| candidate           |   cold |   warm |     inc |
| ------------------- | -----: | -----: | ------: |
| baseline (TS 5.9)   | 12.37s | 10.44s |  11.85s |
| **baseline (TS 7)** |  8.20s |  6.90s |   6.99s |
| Turborepo 2.10.7    | 12.22s |  1.08s |   8.86s |
| Vite+ 0.2.6         | 11.85s |  8.54s | 8.17s ⚠ |

Typecheck alone:

| candidate           |  cold |  warm |             inc |
| ------------------- | ----: | ----: | --------------: |
| baseline (TS 5.9)   | 5.16s | 4.29s |           4.39s |
| **baseline (TS 7)** | 1.73s | 1.18s |           1.18s |
| Turborepo           | 3.36s | 0.36s |           3.37s |
| Vite+               | 2.57s | 0.46s | 0.46s ⚠ unsound |

### TypeScript 7 answers the typecheck question on its own

TS 7.0 went GA on 8 July 2026 and the Go-native compiler ships as the ordinary
`tsc` — there is no separate `tsgo` binary outside the nightly channel. Upgrading
was a two-line dependency bump: **zero type errors**, lint, build and all 206
tests green.

Typecheck went **4.29s → 1.18s (3.6x)**. That is the largest single win measured,
and it needs no task runner, no config file and no cache. Route (b) is confirmed:
a single root `tsconfig.json` is comfortably fast enough, and project references
stay correctly rejected — on these numbers they would buy nothing.

### Why per-package tasks make typecheck slower

Every package exports `./src/index.ts` directly; there is no build step between
packages. So a per-package `tsc` re-typechecks its dependencies' **source**. One
root `tsc` checks `@scholia/core` once; eleven per-package invocations check it
seven times. Vite+ reported the duplicated total directly: 6.73s of task work
against the root compiler's 1.18s.

This is the entire shape of the Turborepo result. It is **correct** and wins the
no-change case outright — 1.08s against 6.90s for the whole pipeline — but on the
incremental edit, the loop agents run dozens of times an hour, it is **8.86s
against the baseline's 6.99s**. At this size, splitting work into cacheable units
costs more than the cache returns.

### Vite+ 0.2.6 silently masks type errors under TypeScript 7

With a warm cache, a genuine type error introduced into `packages/core/src/index.ts`
produced **10/10 cache hits and exit code 0** — a green check on code that does
not compile. It reproduces on a package's own source (`packages/db`) too.

Isolated to one cause:

| compiler                | behaviour                                          |
| ----------------------- | -------------------------------------------------- |
| `typescript@5.7.2` (JS) | invalidates, reports `error TS2322`, **exit 2** ✅ |
| `typescript@7.0.2` (Go) | 10/10 cache hit, error masked, **exit 0** ❌       |

Turborepo, same edit, same workspace: **exit 1**, `core:typecheck` re-ran and
reported the error. Vite+'s automatic input tracking observes Node child
processes correctly — editing `packages/theme/scripts/copy-assets.mjs`
invalidated `theme#build` as it should — but does not observe the reads of
TypeScript 7's native Go binary, so `typecheck` caches never invalidate. The
Vite+ typecheck figures above are therefore not performance numbers; they are the
cost of doing nothing.

Vite+ also cannot cache `build` or `test` while orchestrating `package.json`
scripts: it refuses to cache any task that reads and writes the same path, which
every bundler does. The `input`/`output` escape hatch applies only to tasks
declared in `vite.config.ts`, and a name cannot exist as both a task and a
script — so fixing it means migrating off `package.json` scripts entirely.

## Decision

**Adopt TypeScript 7 for typechecking. Do not adopt a monorepo task runner yet.**

`pnpm typecheck` stays one root `tsc` over one root `tsconfig.json`, and the
workspace stays on plain pnpm scripts with `pnpm -r`'s topological ordering. This
is issue #17's explicit "no tool yet" outcome, recorded as such.

## Consequences

- **Typecheck is ~3.6x faster** for no structural change and no new config.
- **No task-graph config to maintain** — no `turbo.json`, no per-package `test`
  scripts invented purely to give a cache something to key on.
- **The no-change case stays slow.** Re-running an untouched workspace costs
  ~6.9s where Turborepo would cost ~1.1s. That is the price of this decision, and
  it is paid mostly in CI.
- **CI keeps re-doing everything on every run.** With one publishable artifact and
  a matrix of two OSes, that is affordable today. It scales linearly with
  packages, so it will not stay affordable forever.
- **TypeScript 7 is three weeks old.** The stable programmatic compiler API is
  targeted at 7.1, not 7.0. Nothing here depends on that API — `tsc` is invoked as
  a CLI — but tooling that does may lag.

## Turborepo is deferred, not rejected

Read casually this ADR looks like a tool that failed. It is not: Turborepo was
correct on every check and won the no-change case by ~6x. The verdict is
contingent on the workspace's **size and shape**, not the tool's quality, and the
thing that makes it lose today is the source-export duplication described above —
not Turborepo.

Re-open this decision when any one of these lands, and **re-run the trial rather
than re-deciding on paper** (`pnpm trial run <label>` / `pnpm trial report`):

1. **Packages gain real build boundaries.** If they publish built `dist` +
   `.d.ts` instead of exporting source, the duplication disappears and
   per-package caching starts paying immediately. This is the likeliest trigger,
   and it arrives on its own the moment a second publishable artifact is wanted.
2. **The root `tsc` stops being fast.** It is ~1.2s warm today. Past roughly 5s,
   the TS 7 win has been consumed.
3. **CI minutes start costing real money.** That argues specifically for remote
   caching — Turborepo's strongest axis, and the one part that needs a login or a
   self-hosted cache.

## Alternatives considered

**Turborepo 2.10.7.** The strongest tool trialled, and the one to return to.
Derives its graph from `package.json`, needed no per-package config beyond a
`turbo.json`, and was correct throughout. Rejected for now only on the
incremental-edit numbers above. Its remote cache — the feature that would most
change CI — needs a login or self-hosted storage, which the ticket's "no daemon
or login" criterion pushes against for local use.

**Vite+ 0.2.6.** Attractive on paper: MIT, beta since 2 July 2026, bundles oxlint
and oxfmt (already adopted in ADR-0024), derives its graph from `package.json`,
and manages the runtime and package manager too. Rejected on the correctness
failure above — a task runner that reports success on code that does not compile
cannot gate CI. Worth re-evaluating once the tracking bug is fixed and it leaves
beta; the oxc alignment is genuine. A reproduction is drafted at
`PROTOTYPE-viteplus-bug-draft.md` on the trial branch.

**Nx and Moon.** The only candidates offering route (a), deriving TS project
references from `package.json`. Not trialled: TS 7 makes that route unnecessary,
and both are heavier than this workspace warrants.

**mise, and Wireit.** Both hand-declare the dependency graph — mise via `depends`
in `mise.toml`, Wireit via per-script `dependencies` in `package.json`. Neither
reads the workspace graph. That is precisely the defect that got TypeScript
project references rejected: a second copy of the graph that drifts. Rejected on
the same principle, consistently applied. mise's toolchain pinning remains
independently interesting and is not foreclosed here.

**Bazel, Pants, Gradle, Rush, Lerna, Lage.** Bazel, Pants and Gradle are polyglot
heavyweights aimed at a scale 11 TypeScript packages do not reach. Rush takes over
package management and would fight the pnpm workspace. Lerna is a publishing tool.
Lage is Turborepo-shaped with a fraction of the adoption.

# PROTOTYPE findings — monorepo tooling & the typecheck pipeline (#17)

Throwaway. This file is the *answer*; the ADR that supersedes it belongs on main.

**Question:** does a monorepo task runner earn its place in this 11-package
workspace, and what settles the typecheck story?

**Verdict: no tool yet. Adopt TypeScript 7; keep the single root `tsconfig.json`
and the pnpm scripts.**

Machine: Apple M2, 8 cores, otherwise idle. Median wall clock, `pnpm trial`
harness (`scripts/prototype-task-runner-trial.mjs`), 183 TS/TSX files.
`cold` = all caches cleared. `warm` = re-run, nothing changed. `inc` = one real
content edit to `packages/core/src/index.ts`, the leaf 7 packages depend on.

## Numbers

| typecheck    |  cold |  warm |   inc |
| ------------ | ----: | ----: | ----: |
| baseline-ts5 | 5.16s | 4.29s | 4.39s |
| baseline-ts7 | 1.73s | 1.18s | 1.18s |
| turbo        | 3.36s | 0.36s | 3.37s |
| viteplus     | 2.57s | 0.46s | 0.46s ⚠ unsound — see below |

| test         |  cold |  warm |   inc |
| ------------ | ----: | ----: | ----: |
| baseline-ts5 | 3.69s | 3.34s | 3.40s |
| baseline-ts7 | 3.50s | 3.29s | 3.36s |
| turbo        | 5.82s | 0.36s | 2.97s |
| viteplus     | 6.97s | 5.94s | 5.97s |

| build        |  cold |  warm |   inc |
| ------------ | ----: | ----: | ----: |
| baseline-ts5 | 3.52s | 2.81s | 4.06s |
| baseline-ts7 | 2.97s | 2.43s | 2.45s |
| turbo        | 3.04s | 0.36s | 2.52s |
| viteplus     | 2.31s | 2.14s | 2.20s |

Whole-pipeline totals (typecheck + test + build):

| candidate    |   cold |   warm |    inc |
| ------------ | -----: | -----: | -----: |
| baseline-ts5 | 12.37s | 10.44s | 11.85s |
| baseline-ts7 |  8.20s |  6.90s |  6.99s |
| turbo        | 12.22s |  1.08s |  8.86s |
| viteplus     | 11.85s |  8.54s |  8.17s ⚠ |

## 1. TypeScript 7 is the whole typecheck story

TS 7.0 went GA on 8 July 2026; `typescript@latest` is `7.0.2` and the Go-native
compiler ships as the ordinary `tsc`. Upgrading was a one-line change:
**zero type errors**, lint/build/test all green, 206 tests passing.

Typecheck went **4.29s → 1.18s (3.6x)**. That is the largest single win measured
here and it needs no task runner, no config file and no cache.

The issue offered two live routes. Route (a) — a tool deriving TS project
references from `package.json` — died with Nx and Moon. Route (b) is confirmed:
**a single root `tsconfig.json` is comfortably fast enough.** Project references
remain correctly rejected; on these numbers they would buy nothing.

## 2. Per-package tasks make typecheck *slower*, which is why turbo loses

Every package exports `./src/index.ts` directly — there is no build step between
packages. So a per-package `tsc` re-typechecks its dependencies' **source**. One
root `tsc` checks `core` once; eleven per-package invocations check it seven
times. Vite+ measured the duplicated total directly: 6.73s of task work versus
the root compiler's 1.18s.

That is the whole shape of the turbo result. Turborepo is **correct** and wins
"nothing changed" outright (1.08s vs 6.90s for the full pipeline) — but on the
incremental edit, the loop that actually runs dozens of times an hour, it is
**8.86s against the baseline's 6.99s**. Splitting the work into cacheable units
costs more than the cache returns at this size.

Turbo's win is real but narrow: it is a CI-re-run and untouched-package win, and
banking it properly wants remote caching, i.e. a Vercel login or a self-hosted
cache. The issue's own criterion ("local scripts still work without a daemon or
login") is met locally either way.

## 3. Vite+ 0.2.6 silently masks type errors under TypeScript 7 ⚠

The serious finding. With a warm cache, a genuine type error introduced into
`packages/core/src/index.ts` produced **10/10 cache hits and exit code 0**.
Green CI on code that does not compile. It reproduces on a package's own source
(`packages/db`) too.

Isolated to a single cause:

| compiler                    | result                                          |
| --------------------------- | ----------------------------------------------- |
| TypeScript 5.7 (JS `tsc`)   | invalidates correctly, **exit 2**, error reported |
| TypeScript 7 (Go `tsc`)     | **10/10 cache hit, exit 0**, error masked        |

Turborepo, same edit, same workspace: **exit 1**, `core:typecheck` re-ran and
reported the error.

Vite+'s automatic input tracking observes Node child processes correctly —
editing `packages/theme/scripts/copy-assets.mjs` invalidated `theme#build` as it
should. It does not observe the reads of TypeScript 7's **native Go binary**, so
`typecheck` caches never invalidate. The `viteplus` typecheck column above is
therefore not a performance number; it is the cost of doing nothing.

This is a beta-stage bug (Vite+ went beta 2 July 2026), not a design flaw, and
worth reporting upstream.

### Vite+ also cannot cache build or test in this scope

`vp run` refuses to cache any task that reads and writes the same path — which
every bundler does:

- `@scholia/web#build` — "read and wrote `packages/web/dist/index.html`"
- `@scholia/local#build` — "read and wrote `dist/assets/katex/katex.min.css`"
- all five `#test` tasks — vitest writes `node_modules/.vite/vitest/results.json`
  and a `vitest.config.ts.timestamp-*.mjs`, because every package shares the root
  vitest config via `--root ../..`

The escape hatch (`input: [{auto:true}, '!dist/**']`, `output: ['dist/**']`)
applies only to **tasks declared in `vite.config.ts`**, and a name cannot exist as
both a task and a `package.json` script. Fixing it therefore means migrating the
scripts into Vite+ tasks — the full-toolchain adoption deliberately left out of
scope. Within the scope trialled, Vite+ is slower than doing nothing on `test`
(5.97s vs 3.36s).

## 4. Rejected without trialling

- **Nx, Moon** — narrowed out. They were the only candidates offering route (a);
  TS 7 makes that route unnecessary.
- **mise** — real monorepo tasks, no daemon, no login, and it adds toolchain
  pinning. But the graph is hand-declared via `depends`; it does not read
  `package.json`. That is exactly the defect that got project references rejected
  — a second copy of the dependency graph that will drift. Same objection retires
  **Wireit** (per-script `dependencies` by hand, pre-1.0, no remote cache).
- **From monorepo.tools:** Bazel/Pants/Gradle (polyglot heavyweights, wrong
  scale), Rush (takes over package management, fights the pnpm workspace), Lerna
  (a publishing tool now), Lage (Turborepo-shaped, far less adoption). The page is
  Nx-authored, claims native remote caching for all nine, and omits Vite+, Wireit,
  mise and pnpm — a candidate list, not evidence.

## 5. Incidental defects found (worth fixing on main regardless)

- `packages/theme` builds into `fonts/`, not `dist/`. Any output-declaring cache
  must be told, or it replays a "hit" without restoring the fonts. Turbo warned;
  I had to add `fonts/**` by hand.
- `packages/cli`'s build hand-rolls a dependency edge —
  `pnpm --filter @scholia/local build && tsup && …` — so `@scholia/local` builds
  twice under `pnpm -r build`. Any real task graph makes that edge redundant.
- `packages/bridge` has `build:iframe`, not `build`, so `pnpm -r build` skips it.
  Inconsistent naming that a task runner would silently inherit.
- Packages have no `test` script at all; `pnpm test:ci` is one root vitest run.
  Per-package caching required inventing them.

## Recommendation

1. **Adopt TypeScript 7** — the entire measured win, on its own.
2. **No task runner yet.** Record as the issue's explicit "not yet" outcome.
3. **Turborepo is deferred, not rejected.** See the triggers below.
4. Re-evaluate **Vite+** after the tracking bug is fixed and it leaves beta. The
   oxc alignment with ADR-0024 is genuine and the toolchain-pinning story is
   attractive; the caching is not trustworthy yet under TS 7.

## Revisit triggers — Turborepo is deferred, not rejected

This must survive into the ADR. Read casually, "no tool yet" looks like a tool
that failed; it isn't. Turborepo was **correct on every check** and won the
no-change case by roughly 6x (1.08s vs 6.90s). The verdict is contingent on the
workspace's *size and shape*, not on the tool's quality — so it should be
re-opened when the shape changes, not on a calendar.

The whole reason it loses today: packages export `./src/index.ts` with no build
step between them, so per-package `tsc` re-checks dependencies' source seven
times over. That duplication — not Turborepo — is what costs more than the cache
returns.

Any one of these flips the math:

1. **Packages gain real build boundaries.** If they ever publish built `dist` +
   `.d.ts` instead of exporting source, the duplication disappears and
   per-package caching starts paying immediately. This is the likeliest trigger
   and the one to watch — it arrives on its own the moment a second publishable
   artifact is wanted.
2. **The root `tsc` stops being fast.** It is ~1.2s warm on TS 7. Past roughly
   5s, the 3.6x TS 7 win has been consumed and caching unchanged packages pays.
3. **CI minutes start costing real money.** That argues specifically for remote
   caching, Turborepo's strongest axis — and the one thing that needs a login or
   a self-hosted cache.

When any of these lands, re-run the trial rather than re-deciding on paper:
`pnpm trial run <label>` / `pnpm trial report`.

## Branches

- `prototype/task-runner-trial` — harness + TS 5.x baseline
- `prototype/trial-ts7` — TypeScript 7 upgrade
- `prototype/trial-turbo` — Turborepo wiring
- `prototype/trial-viteplus` — Vite+ wiring

Re-run any of them with `pnpm trial run <label>` / `pnpm trial report`.

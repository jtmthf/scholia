# ADR-0037: Adopt Turborepo, now that packages have real dist build boundaries

- Status: Accepted
- Date: 2026-08-10
- Supersedes: the task-runner half of ADR-0025 (its TypeScript 7 decision stands unchanged)

## Context

Issue #131 named a concrete problem with the root scripts, not an abstract one:
`pnpm scholia` ran the CLI from source without building the workspace packages
it depends on, so Local Preview could serve a stale or missing
`@scholia/local` browser bundle. `pnpm build` didn't exist at all — the root
had no `build` script, `pnpm build -r` isn't discoverable, and the thirteen
purpose-built scripts (`dev:server`, `dev:web`, `db:*`, `e2e:*`,
`prototype:*`) that had accreted at the root were exactly the kind of surface
ADR-0025 warned would keep growing.

ADR-0025 rejected a task runner for a specific, falsifiable reason: every
package exported `./src/index.ts` directly, so a per-package `tsc` re-checked
its dependencies' source on every run — eleven packages checking `@scholia/core`
seven times over, where one root `tsc` checked it once. That ADR named its own
revisit trigger up front:

> **Packages gain real build boundaries.** If they publish built `dist` +
> `.d.ts` instead of exporting source, the duplication disappears and
> per-package caching starts paying immediately.

That is precisely what issue #131 asked for — universal `dist` exports via
`tsup` — so this is that trigger firing, not a reversal on the merits. ADR-0025
also said to re-run the trial rather than re-decide on paper; the trial
harness lived on a branch that was never merged, so the numbers below come
from this migration itself rather than `pnpm trial`.

## Decision

**Adopt Turborepo. Give every `packages/*` library a `tsup` build emitting to
`dist/`, and switch `main`/`types`/`exports` to point there instead of
`./src/*`.**

- Root `turbo.json` owns four tasks: `build` (`dependsOn: ["^build"]`),
  `typecheck` (`dependsOn: ["^typecheck"]`), `test`
  (`dependsOn: ["^build", "build"]`), and `scholia`
  (`dependsOn: ["^build"]`, uncached — it's the CLI itself, not a build step).
- Root scripts become thin wrappers: `build`, `typecheck`, and `test` are
  `turbo run <task>`; `test:watch` is `turbo watch test`. `scholia` is
  `turbo run scholia --`, so `pnpm scholia <path>` still builds the
  dependency graph first, same as the issue asked.
- `test:projects` / `test:projects:watch` stay a plain `vitest run` / `vitest`
  against a root `vitest.config.ts` using `projects: ["packages/*"]` — one
  process, every package, for local iteration where spinning up turbo's own
  scheduling isn't worth it. `@scholia/vitest-config` holds the settings both
  entry points share, so there's exactly one place that owns them.
- Two new shared-config packages, `@scholia/tsconfig` and
  `@scholia/vitest-config`, replace the root `tsconfig.base.json` and the
  settings that used to live inline in the root `vitest.config.ts`.

### tsup can't emit declarations under TypeScript 7 yet

`tsup`'s `dts: true` goes through `rollup-plugin-dts`, which needs the
compiler's programmatic API — and ADR-0025 already flagged that this API
"is targeted at 7.1, not 7.0." It isn't there yet (7.1 is still pre-release as
of this writing): `rollup-plugin-dts` crashes on
`Cannot read properties of undefined (reading 'useCaseSensitiveFileNames')`
the moment a build tries to use it. Plain `tsc` emitting declarations from the
CLI doesn't touch that API and works fine — it's the same mechanism `typecheck`
already used for checking, just with `noEmit: false`.

So `build` (`tsup`) and `typecheck` (`tsc`) split the work: `tsup` owns the
JS, `typecheck` owns `dist/*.d.ts`. That makes `typecheck`, not `build`, the
task other packages' type resolution actually depends on
(`dependsOn: ["^typecheck"]`) — a package whose types nobody has generated yet
is exactly the state a fresh checkout starts in. Both write into the same
`dist/`, so `tsup`'s `clean: true` — which would otherwise erase whichever ran
last — is off everywhere a package has both.

A package whose own tests import it by name (only `@scholia/core`'s do, to
assert the public surface the way a real consumer would) hits the same problem
one level down: that self-import needs `dist/index.d.ts` to already exist
before the first `typecheck` run that would produce it. `tsconfig.json` maps
the package's own name back to its source via `paths` for typechecking only —
runtime resolution (Vitest, and every other consumer) still goes through
`dist`, untouched.

Compiling `test/` alongside `src/` for checking means `rootDir` has to cover
both, so `dist/*.d.ts` lands nested under `dist/src/` for any package with
real test coverage (github, sidecar, ui, local, server) rather than flat at
`dist/index.d.ts`; packages with no tests in scope for `tsc` (db, bridge,
client) stay flat. `package.json`'s `types` field just points at whichever is
real per package. The alternative — TypeScript project references, so `test/`
and `src/` could be separate compilations with a flat `dist/` for both — was
already rejected by name in ADR-0025 as a second copy of the dependency graph
that would drift from `package.json`; introducing it now to tidy up a path
would be re-opening that with less justification, not more.

### Two structural fixes this forced, not incidental cleanup

Real `dist` boundaries mean `rootDir` has to be a real, single directory per
package — which surfaced two test files that reached across a package
boundary with a relative import instead of the package's own name:
`packages/local/test/anchor-corpus.test.ts` importing a helper from
`packages/core/test/helpers/`, and `packages/server/test/client-roundtrip.test.ts`
importing `@scholia/client` from `../../client/src/index.js`. Both silently
worked when every package exported raw source; neither can, once `rootDir`
means something. Fixed by exporting the core test helper as a proper subpath
(`@scholia/core/test/helpers/anchor-corpus.js`, pointing straight at the `.ts`
source — it's test-only, no build needed) and by giving `@scholia/server` an
actual `@scholia/client` devDependency instead of reaching past it.

## Results

Measured on this migration directly (Apple M2). `cold` clears `.turbo` and
every package's `dist/`; `warm` re-runs immediately after with nothing
changed; `inc` is one real content edit to `packages/core/src/index.ts`, the
package the rest of the workspace sits on top of.

|                  |  cold |  warm |   inc |
| ---------------- | ----: | ----: | ----: |
| `pnpm build`     | 3.83s | 0.02s |     — |
| `pnpm typecheck` | 3.08s | 0.01s | 2.26s |

`warm` is what a loop agent or an unrelated CI leg actually pays most of the
time, and it dropped from ADR-0025's baseline of ~1.2s to full-cache-hit
(`>>> FULL TURBO`) in the tens of milliseconds — turbo restoring thirteen
packages' outputs from a content hash rather than re-running anything.

`inc` is the case ADR-0025 warned would get worse, and it did: 2.26s against
that ADR's ~1.18s baseline for the same edit. Nine separate `tsc` process
starts (one per downstream package) cost more here than one root compiler
re-checking everything from a warm in-memory program did. That's the accepted
trade, on the same terms ADR-0025 set: it's paid by whoever is actively
editing `core`, in exchange for everyone else — most runs, most of CI — no
longer paying for a rebuild that changed nothing.

## Consequences

- `pnpm build`/`pnpm typecheck`/`pnpm test` are real, cached, single commands
  for the first time; `pnpm scholia <path>` builds its dependencies first, as
  issue #131 asked.
- Every `packages/*` library now has a `dist/`, gitignored, that has to exist
  before anything importing it will typecheck or run. `pnpm build` (or
  `pnpm typecheck`, which produces the types half on its own) from a clean
  checkout is now a required first step, not an optional optimization.
- `turbo.json` is a second place task wiring can drift from `package.json` —
  exactly the duplication risk ADR-0025 raised about TS project references.
  Unlike project references, turbo derives the graph edges themselves from
  `package.json` dependencies; `turbo.json` only configures cache/order
  behavior on top, so there's one graph, not two.
- No remote cache is configured. Every number above is local-disk caching
  only; CI still pays the `cold` cost on every run. Turbo's remote cache is
  the next lever if CI minutes become the binding constraint, per ADR-0025's
  trigger #3 — not exercised here.
- `packages/tsconfig` and `packages/vitest-config` are new shared-config
  packages. `@scholia/vitest-config` is TypeScript and has the same
  `build`/`typecheck` shape as everything else; `@scholia/tsconfig` ships
  nothing but JSON, so it has neither — both still participate in the
  dependency graph other packages resolve them through.

## Alternatives considered

Re-litigating Turborepo-vs-the-field wasn't in scope here — ADR-0025 already
did that comparison (Vite+, Nx, Moon, mise, Wireit, Bazel/Pants/Gradle, Rush,
Lerna, Lage) and named Turborepo the strongest tool on every axis, deferred
only on the workspace's then-shape. Nothing about those other tools' standing
changed; what changed is the one variable ADR-0025 said would flip the
verdict.

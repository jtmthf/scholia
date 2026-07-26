# Draft upstream bug report — voidzero-dev/vite-plus

Not filed. Review, then submit at https://github.com/voidzero-dev/vite-plus/issues.

---

**Title:** `vp run` script cache never invalidates for TypeScript 7's native
compiler — masks type errors and exits 0

### Summary

With `run.cache.scripts: true`, a `package.json` script that runs TypeScript 7's
`tsc` is cached but its source files are never registered as inputs. Once the
cache is warm, editing the source — including introducing a genuine type error —
produces a cache hit and **exit code 0**. CI goes green on code that does not
compile.

The same script under TypeScript 5.7 invalidates correctly, which isolates the
cause to the native Go compiler binary rather than to `tsc` as such.

### Versions

- `vite-plus@0.2.6`
- `typescript@7.0.2` (fails) / `typescript@5.7.2` (works)
- pnpm 11.7.0, Node 22.23.0, macOS 15 (Darwin 25.5.0), arm64

### Reproduction

pnpm workspace, one package with:

```jsonc
// packages/core/package.json
{ "scripts": { "typecheck": "tsc -p tsconfig.json" } }
```

```ts
// vite.config.ts (workspace root)
export default { run: { cache: { tasks: true, scripts: true } } };
```

```sh
pnpm add -D -w typescript@7

# 1. prime the cache against clean, type-correct source
pnpm vp run --filter "./packages/*" typecheck

# 2. introduce a real type error
printf '\nexport const ERR: number = "not a number";\n' >> packages/core/src/index.ts

# 3. run again
pnpm vp run --filter "./packages/*" typecheck; echo "exit=$?"
```

### Expected

`@scholia/core#typecheck` is a cache miss, `tsc` re-runs, reports
`error TS2322`, and `vp` exits non-zero.

### Actual

```
~/packages/core$ tsc -p tsconfig.json ◉ cache hit, replaying
vp run: 10/10 cache hit (100%), 5.39s saved.
exit=0
```

The type error is never surfaced. `vp run --last-details` reports
`Cache hit - output replayed` for every task.

### Isolating the cause

| compiler                  | behaviour                                          |
| ------------------------- | -------------------------------------------------- |
| `typescript@5.7.2` (JS)   | cache miss, `error TS2322` reported, **exit 2** ✅  |
| `typescript@7.0.2` (Go)   | 10/10 cache hit, no error, **exit 0** ❌            |

Automatic input tracking works correctly for Node child processes in the same
workspace — editing a task's `node scripts/copy-assets.mjs` input invalidated
that task as expected. The failure appears specific to reads performed by a
non-Node native binary, which is what TypeScript 7 ships as the ordinary `tsc`.

Turborepo 2.10.7, given the same edit in the same workspace, correctly re-runs
the task and exits 1.

### Impact

Silent. There is no warning that inputs went untracked — the task is reported as
cached and successful. Any project on TS 7 that enables `cache.scripts` and runs
`tsc` through `vp run` will get false-green typechecks in CI and locally.

### Possible mitigation in the meantime

Treat a task whose tracked-input set comes back empty as uncacheable, and warn,
rather than caching it on an empty fingerprint.

# ADR-0024: oxlint for linting, oxfmt for formatting

- Status: Accepted
- Date: 2026-07-26
- Supersedes: the "No ESLint/Prettier/Biome — `tsc` is the only check" stance in `CLAUDE.md`

## Context

Most code in this repo is agent-written. `tsc` is a strong gate but structurally
blind to a specific defect class: a promise that is never awaited, an `async`
handler passed where a `void` return is expected, an `await` on a non-thenable,
and `any` widening a boundary. All four typecheck cleanly and all four compound
quietly, because the next agent reads the existing code as the pattern to follow.

Issue #16 framed the choice as oxlint vs Biome, turning on two questions:

1. How far have oxlint's type-aware rules (via `tsgolint`) stabilised?
2. Is one tool doing both lint and format worth more than having those rules?

Both were trialled against this codebase at its state on `main` (183 TS/TSX
files, ~24k lines) rather than judged on paper.

## Trial results

Versions: `oxlint@1.75.0` + `oxlint-tsgolint@7.0.2001`, `@biomejs/biome@2.5.5`,
`oxfmt@0.60.0`. Both linters were configured to the same rule intent: the four
async rules, `no-explicit-any`, unused variables, and each tool's default
correctness set.

### The rules the issue is actually about

| Rule                         | oxlint | Biome | Notes                              |
| ---------------------------- | -----: | ----: | ---------------------------------- |
| `no-floating-promises`       |      4 |     4 | Identical locations. Parity.       |
| `no-misused-promises`        | **12** | **0** | See below.                         |
| `require-await` / `useAwait` |     17 |    34 | 18 of Biome's are false positives. |
| `no-explicit-any`            |    207 |   207 | Parity.                            |

**`no-misused-promises` is where the two tools separate.** Biome's rule is
`nursery`-grade and backed by Biome's own partial type inference rather than the
TypeScript compiler. On a self-contained probe file it fires correctly, so the
rule is not misconfigured — but against the real codebase it found nothing, while
oxlint found 12 genuine violations. The gap is cross-module and JSX-contextual
inference. A minimal reproduction:

```tsx
async function save(): Promise<void> {}
export function Probe() {
  return (
    <button type="button" onClick={save}>
      save
    </button>
  );
}
```

oxlint: `Promise-returning function provided to attribute where a void return was
expected.` Biome: clean. Eight of the twelve real findings are exactly this
shape — an `async` handler on a Preact `onClick` — which is the single most
common async-misuse bug in this codebase's UI packages.

**Biome's `useAwait` carries an 18-hit false-positive cluster.** It flags
`async function f(): Promise<T> { return somePromise() }` — an intentional
pattern used throughout `packages/db/src/repos.ts`, `packages/server/src/mirror/`
and `packages/client`. oxlint's type-aware `require-await` knows the returned
value is a Thenable and stays quiet. oxlint had no false positives on this rule.

### How stable are oxlint's type-aware rules?

Stable enough to trust with autofix. The trial's largest type-aware finding was
152 hits of `no-unnecessary-type-assertion`. Rather than eyeball a sample, all
152 were auto-fixed and the workspace re-typechecked: **`pnpm typecheck` passed
clean**, so every one was a true positive and the rule's fix is sound. That is
the answer to question 1 — `tsgolint` is not a preview.

### Speed

|                                         |  wall |  CPU |
| --------------------------------------- | ----: | ---: |
| oxlint (type-aware, whole workspace)    |  1.3s | 3.1s |
| Biome lint (`project` + `test` domains) | 20.4s | 123s |

A ~15x wall-clock gap, and the gap is felt most in the pre-commit and CI loop
that agents run constantly.

### Other findings worth recording

- Biome does not respect `.gitignore` unless `vcs.useIgnoreFile` is set. Without
  it, Biome lints embedded JS inside generated HTML: the first run produced 6,999
  diagnostics, of which **6,104 came from `e2e/playwright-report/index.html`**
  alone. oxlint respects `.gitignore` by default. This is a config gap, not a
  defect, but it is a sharp edge.
- Biome's `useImportExtensions` produced 304 false positives: this workspace uses
  `moduleResolution: "Bundler"`, where extensionless imports are correct.
- Biome's `noUndeclaredDependencies` produced 49 false positives — test files
  importing `vitest`, which is a root devDependency in a pnpm workspace. Biome
  does not resolve workspace-root devDeps.

## Decision

**Adopt oxlint for linting and oxfmt for formatting.** Both are oxc; the pair is
configured by `.oxlintrc.json` and `.oxfmtrc.json` at the repo root, and
`pnpm lint` / `pnpm format` drive them. `tsc` remains the type gate — oxlint is
additive, not a replacement.

Question 2 resolves against the single-tool argument. The type-aware rules are
the entire reason for this ADR: they are what catches the defect class `tsc`
misses, and Biome's equivalents miss the dominant case in this repo. A unified
tool is a convenience; the rules are the requirement.

## Consequences

- **Two config files, not one.** The single-config-at-the-root goal in #16 is met
  in spirit — both files sit at the root and neither is per-package — but not
  literally, because oxc ships lint and format as separate binaries.
- **oxfmt is pre-1.0 (0.60.0).** It is Prettier-compatible by design and
  reformatted 111 of 234 files in the trial without incident, but it is the least
  settled piece of this decision. It is also swappable: formatting is a
  mechanical concern with no bearing on the lint rules, so replacing oxfmt later
  costs one config file and one reformat commit.
- **CSS and JSON go unformatted.** oxfmt handles JS/TS/JSX only. Biome would have
  covered the 8 CSS files and 38 JSON files as well. This is the concrete price
  paid for the type-aware rules, and it is small at this repo's size.
- **`tsgolint` is a second binary on the install path**, and type-aware linting
  needs `--type-aware`. Without the flag, oxlint silently runs the non-type-aware
  subset — so the flag lives in the `package.json` script, not in a habit.

## Alternatives considered

**Biome, as a single tool for lint and format.** Rejected on the trial numbers
above: `noMisusedPromises` found 0 of 12, `useAwait` carried 18 false positives,
and the lint pass is ~15x slower. Its formatter is genuinely better than oxfmt —
stable, and it covers CSS and JSON — but adopting Biome means giving up the rules
that motivated the work.

**oxlint for linting, Biome for formatting.** The strongest technical pairing:
type-aware rules plus a stable formatter with CSS and JSON coverage. Rejected to
avoid carrying two toolchains, two config files and two rule vocabularies for a
gain of 8 CSS files. Worth revisiting if oxfmt stalls before 1.0 or if the CSS
surface grows.

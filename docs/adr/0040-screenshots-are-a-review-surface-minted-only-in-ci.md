# Screenshots are a review surface, and baselines are minted only in CI

## Status

accepted

Answers a gap left by [ADR-0016](./0016-editorial-visual-identity.md) and
[ADR-0039](./0039-the-rail-takes-the-outlines-track.md): both decide what the chrome should
look like, and neither gives a reviewer any way to _see_ what a change did to it.
Constrained by [ADR-0010](./0010-local-preview-is-the-default-entry.md) and CONTEXT's
promise that Local Preview touches no network, and by
[ADR-0037](./0037-adopt-turborepo-and-dist-build-boundaries.md) (every package resolves
through `dist/`, so anything that boots the app pays a build). The measurements this
decision rests on are in
[`docs/research/visual-snapshot-testing.md`](../research/visual-snapshot-testing.md) and are
not restated here.

## Context & Decision

Scholia's product surface is rendered chrome, and it has drifted. #143 (state in the rail
and chrome affordances), #112 (flooring the article column), #163 (the Agent Docs link
colour) and #109 (resolved highlights) all landed against a suite that pins rendered DOM
text and asserts behaviour, but **photographs nothing**. Reviewing them meant reading CSS
diffs and imagining the result. Drift accumulated through PRs that were individually green.

**We photograph the chrome, and the photographs are for a human to look at — never for a
machine to judge taste.** Four arrangements × two themes = eight frames, captured by
Playwright's `toHaveScreenshot()` in its own project and its own CI job.

### The baseline in `main` is the "before"; the PR's commit is the "after"

The review surface is **GitHub's own image diff** — 2-up, swipe, onion-skin in Files
changed. That requires the regenerated PNG to be a committed change on the branch, which is
the whole reason the update loop below exists. No bot, no third-party service, nothing to
download: the picture is in the pull request, next to the code that caused it.

### Baselines are Linux, minted in CI, never on a developer machine

The same Page, byte-identical DOM, CSS and vendored `woff2` rendered over `file://`, differs
in **19,264 of 1,152,000 pixels (1.67%)** between darwin/arm64 and the official
`playwright:v1.61.1-noble` image at Playwright's default `threshold: 0.2` — every glyph,
plus a Nav label wrapping to a different line count. A tolerance wide enough to pass that
detects nothing. Docker does not close the gap on Apple Silicon: `--platform linux/amd64`
aborts under QEMU before Chromium launches.

So the shared environment is CI. This is not our invention — it is Vitest's documented
recipe, which Playwright's own docs do not offer: _"Remember when we mentioned visual tests
need a stable environment? Well, here's the thing: your local machine isn't it."_
([Visual Regression Testing](https://vitest.dev/guide/browser/visual-regression-testing)).

**The `{platform}` token stays in the path template**, though every committed baseline is
`-linux`. Dropping it would let a local run compare a Mac render against a Linux baseline
and report the 1.67% as a regression. Keeping it means a local run fails loudly on a missing
`-darwin` file instead — the failure says "you cannot mint these here", which is true.

### Updating is a separate, manually dispatched workflow

`update-screenshots.yml` is `workflow_dispatch`, `contents: write`, feature-branches-only,
and it commits and pushes the regenerated baselines itself. `check.yml` stays
`contents: read`.

Being manual is what makes committing from CI tractable: a `workflow_dispatch` workflow
cannot retrigger itself on push, so there is no loop guard to get wrong, and a maintainer
dispatches it, so it does not depend on a fork PR's read-only token. Vitest's docs give the
same reasoning for the same shape — _"You don't want to update screenshots on every PR
automatically (chaos!)."_

### The check is required, so baselines cannot go quietly stale

`visual` joins `check (ubuntu-latest)`, `check (windows-latest)` and `e2e` in `main`'s
required contexts. A chrome change therefore cannot merge without someone regenerating the
frames, which is exactly the point: an advisory check that nobody updates decays into eight
PNGs of how the product looked last year.

Because `enforce_admins` is `false`, this is a **forcing function rather than a wall** —
deliberate drift is still one bypass away. It prevents silent drift, which is the kind that
happened.

### Local Preview only, in its own job

The visual project boots Local Preview with `SCHOLIA_E2E_NO_WEBSERVER=1` — no Postgres, no
MinIO, no `turbo run scholia` forking child processes. That keeps it off the `e2e` job's
critical path (~4m20s of a ~4m30s wall clock) and away from the process contention that
forced `workers: 1` there. The hosted Viewer is deliberately not photographed: it drags in
the whole stack and [ADR-0038](./0038-hosted-viewer-renders-a-read-only-rail-until-hydration.md)'s
two legitimate render states, which `toHaveScreenshot()`'s settle loop would pick between
non-deterministically.

### What stays text

The DOM-text goldens in `packages/local/test/__snapshots__/` are not a weaker screenshot —
they are a different instrument and the better one for structure, escaping, ordering and the
hydration boundary. They survived the Preact SSR rewrite byte for byte, which told a
reviewer something a pixel baseline could not. Structure is text; colour, spacing, weight and
wrapping are a picture.

Note the vocabulary: **pixel baseline** and **DOM-text golden**. In this domain "snapshot"
already means a Version (CONTEXT), and is not used for either.

## Considered Options

- **A hosted service (Argos, Chromatic, Percy).** Argos is the best-behaved — free OSS tier,
  off-repo baselines, diff highlighting, and the only one with documented tokenless fork-PR
  auth. Rejected because GitHub's own image diff is sufficient for eight frames, and because
  making the visual contract depend on a third party's account is the first place Scholia's
  no-network posture would break — for the surface the product is named after. Revisit if
  the frame count or the contributor count grows.
- **Commit darwin baselines and never compare in CI.** Dodges the platform split entirely
  and still yields a GitHub image diff. Rejected once the Vitest recipe showed CI-minted
  baselines are a solved workflow rather than an invention: this variant buys simplicity by
  giving up any enforcement that the picture is current.
- **Computed-style and geometry assertions instead.** They catch #163, #109, #114 and #75
  precisely and deterministically, and extend what ADR-0039 already committed to. But they
  answer "did this value change", not "does this look right", and the drift here was never a
  failed assertion. Still worth doing — as separate work, not as this decision.
- **Vitest browser mode `toMatchScreenshot()`.** Real and stable since Vitest 4.0, and
  `@scholia/ui` is unusually mountable in isolation thanks to ADR-0030. Rejected for now as a
  second runner beside the Playwright the `e2e` suite already drives, for frames whose drift
  shows up in the assembled arrangement anyway. The natural second step if component-level
  shots become what we want.
- **A paths filter, so only chrome PRs shoot.** Rejected: an unlisted directory is precisely
  how drift arrives.

## Consequences

- **An intentional restyle is a three-step loop**: push, watch `visual` go red, dispatch
  `update-screenshots` on the branch. The red is the signal, not a failure.
- **The repository grows by roughly 0.8 MB per full restyle**, permanently — PNG is already
  compressed, so git stores each revision whole. Against a 28 MB repository today, ten
  restyles is a third of it again. The discipline that keeps this bounded is holding the
  count near eight frames and never using `fullPage`, which would pin prose that changes for
  reasons unrelated to chrome.
- **Fork PRs cannot clear the required check.** `workflow_dispatch` runs on branches in this
  repo, not a contributor's fork, so an outside contributor could neither mint baselines nor
  merge. Theoretical at one contributor; it is the first thing that breaks if that changes,
  and the point at which a hosted service earns reconsideration.
- **Bootstrapping needs one dispatch before the first merge**, since the introducing PR has
  no Linux baselines and the required check will fail on its first run.

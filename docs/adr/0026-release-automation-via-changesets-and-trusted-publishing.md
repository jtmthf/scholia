# ADR-0026: Release automation via Changesets and trusted publishing

- Status: Accepted
- Date: 2026-07-26
- Closes: issue #21

## Context

`scholia@0.1.0` was published by hand from a laptop with `npm publish`. The
manual path has two faults the project cannot afford once releases are frequent
or unattended:

1. **It needs a long-lived credential.** 2FA is enabled on the publisher account,
   so an unattended CI publish needs either a granular token with
   2FA-bypass-for-automation, or trusted publishing via OIDC. A long-lived token
   sitting in repo secrets is exactly the class of credential the rest of the
   project avoids.
2. **It has no versioning discipline.** `CHANGELOG.md` was hand-maintained and a
   second publishable package — coming — would multiply that surface.

## Decision

Adopt **Changesets** for versioning and changelog generation, and **npm trusted
publishing (OIDC)** for the publish itself. No long-lived token in repo secrets.

- `.changeset/config.json` opts the private `@scholia/*` packages out of
  versioning (`privatePackages: { version: false, tag: false }`). Only the
  published `scholia` CLI is versioned; this matches the policy in
  `CHANGELOG.md` ("Only the published package (`scholia`) is versioned") and
  avoids bumping internal packages that ship only inside the CLI bundle.
- `@changesets/changelog-github` generates the changelog from the commit/PR
  context, writing under `## [<version>](...)` headings. The existing `0.1.0`
  entry is preserved verbatim below the generated sections.
- The `check` workflow grows a `changeset` job that runs
  `pnpm changeset status --since=origin/main` on PRs. Because private packages
  are opted out of versioning, only PRs touching the CLI need a changeset; a PR
  confined to an internal package passes without one.
- The `release` workflow triggers on every push to `main` and uses
  `changesets/action@v1`:
  - pending changesets → the action opens/updates a `chore(release): version
packages` PR that runs `changeset version`, regenerates `CHANGELOG.md`,
    bumps `packages/cli/package.json`, and commits;
  - no pending changesets → the action runs `pnpm release`, which builds
    `packages/cli/dist` and publishes to npm with `provenance`, then tags
    `v<version>` and creates a GitHub Release.
- `publishConfig.provenance: true` in `packages/cli/package.json` makes
  `npm publish` emit a provenance attestation by default, so trusted publishing
  is on whether the publish goes through `pnpm changeset publish` or a direct
  `npm publish`.

## Trusted publishing, not a granular token

The workflow declares `permissions: { id-token: write }` and uses
`actions/setup-node@v4` with `registry-url: https://registry.npmjs.org`. With
`provenance` on, `npm publish` mints a short-lived publish token from GitHub's
OIDC endpoint; no `NPM_TOKEN` secret is needed. The credential is gone the
moment the job ends.

This requires a one-time configuration on the npm side: the `scholia` package
must declare this workflow (`jtmthf/scholia`'s `release.yml`) a trusted
publisher. That step is out of this repo's tree — it is recorded as part of the
end-to-end verification, not the automation code.

## Consequences

- **One release PR per cycle.** The `chore(release): version packages` PR is
  the merge gate for a release — squash-merging it is what publishes, which fits
  the existing linear-history convention in `CONTRIBUTING.md`.
- **Two OS-matrix `check` legs stay unchanged.** The release job is its own
  ubuntu-latest leg, so the 2-OS matrix in `check` is untouched.
- **`dist` is rebuilt in CI.** `dist/` is gitignored (`.gitignore`), so the
  publish job rebuilds the bundle right before `pnpm changeset publish`; what
  ships is reproducible from the source tree, not whatever happened to be on
  the laptop.
- **A second publishable package costs nothing here.** When a second package
  becomes publishable, the only change is its own `publishConfig` and removing
  its `private: true`; the workflow and Changesets config already generalise.
- **Provenance attestations become public.** Each published version on npm
  carries a signed link from the `scholia` GitHub workflow back to the source
  commit, which the npm UI surfaces. This is a feature, not a side effect.

## Alternatives considered

- **Granular npm token with 2FA-bypass-for-automation in repo secrets.** Workable
  but puts a long-lived credential in the secret store; trusted publishing keeps
  the credentials-zero posture the rest of the project already has.
- **Release-please / semantic-release.** Both can publish with OIDC, but neither
  has Changesets' first-class monorepo awareness, and `release-please` would
  fight the private-public package split the workspace already encodes in
  `package.json`. Changesets' interactive `pnpm changeset` step also fits an
  agent-friendly workflow — a contributor (human or agent) writes one file,
  CI does the rest.
- **Hand-maintained `CHANGELOG.md`.** Rejected: it does not scale past one
  package and loses the commit-link context the changelog function writes for
  free.

## Future: migration to pnpm native versioning

[pnpm/rfcs#18 "Native monorepo versioning"](https://github.com/pnpm/rfcs/pull/18)
(merged 2026-07-13) proposes a built-in replacement for `@changesets/cli`:
`pnpm change [--bump <type>] [--summary <text>] [<pkg>...]`,
`pnpm change status`, `pnpm change check`, `pnpm version -r`. The `--bump` and
`--summary` flags are exactly the non-interactive authoring surface
`@changesets/cli` lacks — an agent can call them without driving an interactive
prompt. The RFC was written for pnpm's own monorepo and is already substantially
implemented (pnpm/pnpm#12953, #12949, #12971, #12979, #13195), with releases
shipping out of the new pipeline (pnpm/pnpm#12986, #13113).

The decision here is to **stay on Changesets and adopt the direct-to-file
authoring convention, not migrate yet**. Reasons:

- **Direct-to-file is already agent-friendly.** A changeset is a small Markdown
  file with YAML frontmatter. An agent writes it in one shot; no interactive
  prompt to drive. `AGENTS.md` documents the format. pnpm native versioning's
  agent win is convenience (a CLI flag), not capability — both paths produce the
  same `.changeset/*.md` artifact, by design.
- **The RFC makes Changesets forward-compatible, not throwaway.** On-disk intent
  files are the same YAML-frontmatter format. The RFC quotes "Existing
  repositories can adopt it by deleting a devDependency." Our change files survive
  the migration unchanged.
- **The release-side seam is unsettled.** Our release workflow's load-bearing
  piece is OIDC publish from GitHub Actions via `changesets/action@v1`. The RFC
  lists "first-party GitHub Action vs recipes-only" as an _open_ Unresolved
  Question. Until pnpm ships a first-party action or a known-good recipe for
  OIDC publish + tag + GitHub Release, migrating means writing that seam
  ourselves on a <2-week-old feature.
- **The feature is not done.** Follow-up pnpm/pnpm#13134 ("finish native
  versioning") is open. Adopting on a moving target, on the release pipeline
  (highest blast radius), is not worth the convenience gain at the authoring
  layer.

Migration becomes worth the cost when **all three** of these fire:

1. **pnpm declares the feature done** — pnpm/pnpm#13134 closes.
2. **Our `packageManager` pin is already ≥ pnpm 11.14** — native versioning first
   shipped in 11.13.0; the pin today is `pnpm@11.7.0`. We migrate when an
   _unrelated_ reason takes pnpm past 11.14 (security advisory, workspace
   feature), not by bumping pnpm solely for this.
3. **The GitHub-Action question is resolved** — pnpm ships a first-party action,
   or a known-good `pnpm version -r` + `pnpm publish -r` + tag + GitHub-Release
   recipe emerges.

A natural review checkpoint fires when (2) happens: we're bumping pnpm anyway,
so we re-check (1) and (3) at the same time. No calendar review.

When that day comes, the migration is small and local: drop the `@changesets/cli`
and `@changesets/changelog-github` devDependencies, move
`.changeset/config.json` into a `versioning:` key in `pnpm-workspace.yaml`, and
point `AGENTS.md` at `pnpm change` instead of the file format. The release
workflow is the one piece that needs rewriting, and only because the action
seam changes. The change files, the changelog, and the trusted-publishing posture
all carry over.

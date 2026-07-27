# Changesets

This folder holds pending changesets — one Markdown file per change, written by
`pnpm changeset` and consumed by the release workflow on the next push to
`main`.

A changeset is **required for any user-facing change to the published CLI**
(`packages/cli`, package name `scholia`). The internal `@scholia/*` workspace
packages are private and unpublished (`private: true`, `version: 0.0.0`), so
`.changeset/config.json` opts them out of versioning with
`privatePackages: { version: false, tag: false }`. A change confined to an
internal package does not need a changeset.

## Adding one

```sh
pnpm changeset
```

Pick `scholia` → `patch` / `minor` / `major` and write a one-line summary in the
present tense. The CI `changeset` job runs `pnpm changeset status --since=origin/main`
and fails a PR that touches the CLI without a changeset.

## Releasing

The `release` workflow on `main` takes it from here:

1. If pending changesets exist, `changesets/action` opens/updates a
   `chore(release): version packages` PR that runs `changeset version`,
   regenerates `CHANGELOG.md`, bumps `packages/cli/package.json`, and commits.
2. When that PR is merged with no further changesets pending, the action runs
   `pnpm release` — which builds the CLI bundle and publishes to npm via
   [trusted publishing](https://docs.npmjs.com/generating-provenance-statements#trusted-publishing-on-github-actions)
   (OIDC, no `NPM_TOKEN`), provenance on — then tags `v<version>` and creates a
   GitHub Release.

See [ADR-0026](../docs/adr/0026-release-automation-via-changesets-and-trusted-publishing.md)
for the why.

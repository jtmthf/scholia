# Changesets

This folder holds pending changesets — one Markdown file per change, written by
`pnpm changeset` and consumed by the release workflow on the next push to
`main`.

A changeset is **required for every PR**. The `scholia` CLI package carries the
user-facing changelog; internal `@scholia/*` changes ride along under the same
version bump. `.changeset/config.json` opts internal packages out of independent
versioning with `privatePackages: { version: false, tag: false }`.

## Adding one

`pnpm changeset` is interactive — **agents should write the file directly
instead**. A changeset is one Markdown file under `.changeset/` with this exact
shape:

```md
---
"scholia": patch
---

One-line summary in the present tense. Markdown is allowed below the blank line;
the summary becomes the CHANGELOG entry.
```

The version bump is `patch` (bug fix), `minor` (feature), or `major` (breaking).
The filename is arbitrary (kebab-case, e.g. `.changeset/fix-port-cli-flag.md`);
only one changeset per change.

Humans can run `pnpm changeset` and pick `scholia` → `patch` / `minor` / `major`
interactively. Either way, the CI `changeset` job runs
`pnpm changeset status --since=origin/main` and fails a PR that touches the CLI
without a changeset.

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

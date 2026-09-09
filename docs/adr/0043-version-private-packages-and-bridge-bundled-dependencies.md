# ADR-0043: Version private packages and bridge bundled dependencies

- Status: Accepted
- Date: 2026-09-09
- Closes: issue #87
- Amends: ADR-0026

## Context

The published `scholia` package bundles private workspace packages into its
single CLI artifact. A change in `@scholia/ui`, for example, changes the bytes
users install by flowing through `@scholia/local`, even when no CLI source file
changes.

Changesets previously ignored private packages, so those changes produced no
release at all. Enabling private package versioning restores their dependency
edges, but it does not complete the cascade: the CLI correctly declares its
inlined workspace packages as devDependencies so npm does not try to install
unpublished packages, and Changesets intentionally does not bump a package when
only a devDependency changes.

Release version commits also run the repository's pre-commit hook. In a fresh
release checkout the workspace declarations in `dist/` do not exist yet, so
type-aware lint fails on unresolved workspace types before the bot can create
the version PR.

## Decision

- Set `privatePackages.version` to `true` and keep
  `privatePackages.tag` set to `false`. Private package versions and changelogs
  are release bookkeeping; private packages remain unpublished and untagged.
- Run `scripts/version-packages.mjs` as the Changesets action's version command.
  It asks Changesets for the release plan and adds one patch changeset for
  `scholia` when a package bundled directly by the CLI is being released but
  Changesets assigned the CLI no release. Changesets then performs its normal
  version operation.
- Keep bundled workspace packages in `devDependencies`. Their installation
  classification remains truthful; the release wrapper owns the separate fact
  that their code is inlined into the published artifact.
- Set `LEFTHOOK=0` only on the Changesets action step. Pull-request checks still
  run formatting, lint, typechecking, and tests; the bot's generated commit does
  not rerun local developer hooks in an unbuilt checkout.
- Exercise the actual Changesets CLI against a temporary three-package
  `workspace:*` fixture so the transitive UI → Local Preview → CLI release is a
  checked contract.

## Consequences

- Any bundled internal change gives the changed npm artifact a new CLI version.
- Private package versions advance and their changelogs are committed, but npm
  receives only publishable packages.
- The small list of direct packages inlined by the CLI lives beside the release
  wrapper and must change when `packages/cli/tsup.config.ts` changes that
  boundary.
- Release commits no longer fail because a local hook assumes build artifacts
  that the release workflow has not generated.

## Alternatives considered

- **Move bundled packages to `dependencies`.** Rejected: npm would expose
  installation dependencies on packages that are intentionally private and
  already inlined into `dist/cli.js`.
- **Put the CLI and all private packages in one Changesets fixed group.**
  Rejected: it would align unrelated package versions and release the CLI for
  private hosted-only changes that cannot affect its artifact.
- **Require every internal changeset to name `scholia` manually.** Rejected:
  that recreates the silent-release footgun as a contributor convention rather
  than making the release graph enforce it.

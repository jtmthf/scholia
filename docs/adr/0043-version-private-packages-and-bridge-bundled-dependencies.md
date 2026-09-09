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

So exactly four edges in the graph are invisible to Changesets — the CLI's
devDependencies on `@scholia/client`, `@scholia/core`, `@scholia/local`, and
`@scholia/sidecar`. Every other edge that carries bundled code into the artifact
is an ordinary `dependencies` edge that Changesets already follows.

Release version commits also run the repository's pre-commit hook. In a fresh
release checkout the workspace declarations in `dist/` do not exist yet, so
type-aware lint fails on unresolved workspace types before the bot can create
the version PR.

## Decision

- Set `privatePackages.version` to `true` and keep `privatePackages.tag` set to
  `false`. Private package versions and changelogs are release bookkeeping;
  private packages remain unpublished and untagged.
- Put `scholia` and those four packages in one Changesets `fixed` group. The
  group is not "the private packages" — it is precisely the set of edges the
  devDependency classification hides, so declaring it restores the release graph
  Changesets would have computed on its own. Everything further out
  (`@scholia/ui`, `@scholia/theme`, `@scholia/bridge`) still reaches the CLI the
  ordinary way, by cascading into a group member.
- Keep bundled workspace packages in `devDependencies`. Their installation
  classification stays truthful; the `fixed` group owns the separate fact that
  their code is inlined into the published artifact.
- Set `LEFTHOOK=0` only on the Changesets action step. Pull-request checks still
  run formatting, lint, typechecking, and tests; the bot's generated commit does
  not rerun local developer hooks in an unbuilt checkout.
- Exercise the actual Changesets CLI against a temporary workspace fixture so
  the transitive UI → Local Preview → CLI release, the bump type that reaches
  the CLI, and the hosted-only packages that must _not_ release it are all
  checked contracts.

## Consequences

- Any bundled internal change gives the changed npm artifact a new CLI version,
  at the bump type the change actually warrants — a `minor` in `@scholia/core`
  reaches users as a `minor` on `scholia`.
- The five group members share one version line, so the four private ones
  advance on every CLI release whether or not they changed. They are never
  published, so their version is bookkeeping and the shared line costs nothing.
- Hosted-only work (`@scholia/db`, `@scholia/server`, `@scholia/web`) versions on
  its own and releases no CLI.
- The group must change when `packages/cli/package.json` changes which workspace
  packages the CLI depends on. `packages/cli/test/release.test.ts` fails when the
  cascade stops reaching the CLI, but a package added to the bundle and to
  neither list is only caught by review.
- Release commits no longer fail because a local hook assumes build artifacts
  that the release workflow has not generated.

## Alternatives considered

- **Move bundled packages to `dependencies`.** Rejected: npm would expose
  installation dependencies on packages that are intentionally private and
  already inlined into `dist/cli.js`.
- **Put the CLI and _all_ private packages in one fixed group.** Rejected: it
  would release the CLI for hosted-only changes that cannot affect its artifact.
  Restricting the group to the CLI's own bundled devDependencies keeps that
  boundary — the hosted packages stay outside it.
- **Wrap `changeset version` in a script that injects a synthetic `scholia`
  changeset** when the release plan bumps a bundled package. Rejected: it
  reimplements `fixed` as a JSON-parsing shell-out, and having no bump type to
  reason from it has to hardcode `patch` — shipping a bundled feature as a fix.
- **Require every internal changeset to name `scholia` manually.** Rejected:
  that recreates the silent-release footgun as a contributor convention rather
  than making the release graph enforce it.

# Contributing

Thanks for looking. This is a small project with a specific shape, so a few
things are worth knowing before you spend time on a change.

## What's actually shipped

The released npm package (`scholia`) is **Local Preview only** — the
`scholia <path>` command. The hosted side of the project (sharing, anchored
comment threads, versioning, the agent API) is built in this repo but ships in
no release yet, and its commands are hidden behind `SCHOLIA_HOSTED=1`. See
[Hosted mode](./README.md#hosted-mode-not-shipped-yet).

That means a PR against the hosted path is welcome but won't reach users for a
while, and a PR against Local Preview is the one that lands soonest.

## Setup

Node 22 or newer, and pnpm (the version is pinned in `package.json`'s
`packageManager`, so `corepack enable` is enough to get the right one).

```sh
pnpm install
pnpm typecheck     # tsc across the workspace
pnpm lint          # oxlint --type-aware (catches what tsc misses)
pnpm format        # oxfmt
pnpm test:ci       # what CI runs
```

Run the CLI from source:

```sh
pnpm --filter @scholia/local build   # build the browser bundle once
pnpm scholia ./path/to/docs
```

## Things that will trip you up

**oxlint + oxfmt are the linter and formatter** (ADR-0024). `tsc` remains the
type gate. Match the style of the file you're editing — oxfmt will enforce it.

**Relative imports use the `.js` extension**, even from `.ts` files — the repo
is ESM with `NodeNext` resolution:

```ts
import { createApp } from "../src/app.js";
```

**`pnpm test` can pass without running anything that matters.** The server and
db tests skip themselves when `DATABASE_URL` is unset, so a green run may mean
the entire hosted suite never executed. To actually run it:

```sh
docker compose up -d        # Postgres (host port 5544) + MinIO
pnpm db:migrate
DATABASE_URL=postgres://scholia:scholia@127.0.0.1:5544/scholia pnpm test
```

Postgres is on port **5544**, not 5432, so it doesn't collide with a
host-managed Postgres — and use **`127.0.0.1`**, not `localhost`, which can
resolve to IPv6 `::1` and fail to connect. Getting this wrong is the most
common failure in this repo.

CI runs `pnpm test:ci`, which is scoped to the shipping and pure packages and
deliberately excludes `@scholia/server`. You don't need Postgres for a Local
Preview change.

## Language and architecture

[`CONTEXT.md`](./CONTEXT.md) defines the domain vocabulary — Site, Page,
Version, Anchor, Thread, Outdated, Promotion, and so on — and each term has a
list of words _not_ to use for it. Please match that vocabulary in code,
comments, and UI; it's the main thing keeping the codebase navigable.

Significant architectural decisions live in [`docs/adr`](./docs/adr) as ADRs.
If you're changing something structural, skim the relevant one first, and add a
new ADR rather than quietly reversing an old one.

`packages/core` is pure domain logic — render, Nav, search, blobs. It must not
gain HTTP or database dependencies; keep those in `server` and `db`.

## Pull requests

`main` is protected: changes land through a PR, and both CI legs
(`check (ubuntu-latest)` and `check (windows-latest)`) must pass. The Windows
leg exists because path handling is the most likely thing to diverge across
platforms — if you touch path logic, expect it to be the one that catches you.

No approving review is required, so a maintainer merges once CI is green.
History is linear: squash or rebase, no merge commits.

Please keep the change and its rationale in the PR description — for anything
non-obvious, _why_ is more useful to review than _what_.

## Reporting bugs

Open an [issue](https://github.com/jtmthf/scholia/issues) with your
`scholia --version`, `node --version`, OS, and something reproducible. The bug
template asks for exactly this.

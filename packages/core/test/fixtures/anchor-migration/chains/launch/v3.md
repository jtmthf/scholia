# Launch checklist — Local Preview CLI (v0.1)

Scope: ship `collab <path>` (Local Preview, ADR-0010) as a standalone,
installable CLI. **Out of scope for this launch:** `share`, `chats`, `state`,
`rotate-share`, `rotate-token`, `delete-site` — everything that talks to
`@collab/server`. Local Preview already touches no network, DB, or token
(per `CLAUDE.md`), which is what makes it launchable on its own.

## 1. Trim the surface

- [x] **Decided: hide entirely, behind a flag.** The hosted commands
      (`share`, `chats`, `state`, `rotate-share`, `rotate-token`,
      `delete-site`) now live in a `registerHostedCommands()` function in
      `packages/cli/src/cli.ts` that is only called when `COLLAB_HOSTED=1`.
      Default builds register Local Preview only, so `scholia --help` and the
      binary surface nothing server-backed; `COLLAB_HOSTED=1` brings them back
      for hosted-path dev. Env var name matches the existing `COLLAB_*`
      convention (kept until the §2 rebrand). `pnpm --filter scholia
      typecheck` clean.
- [ ] ~~If hiding: split `cli.ts` so the local-only binary only imports
      `@collab/local`~~ — **deliberately skipped (chose "hide only").** The
      static `import { CollabClient, ... } from "@collab/client"` and
      `import { share } from "./share.js"` remain, so `@collab/client` +
      `share.ts`/`provenance.ts`/`site-link.ts` still ship in the bundle even
      though the commands are hidden. Revisit if bundle size becomes a
      concern — the trim path is converting the hosted commands to lazy
      `await import()` inside the flag guard so tsup can tree-shake them.
- [x] **Confirmed zero network calls.** Grepped the local command path
      (`@collab/local` + `@collab/core` src) for
      `fetch`/`http`/`undici`/`axios`/`WebSocket`. The only hits: `server.ts`
      passing Hono's `app.fetch` handler to `@hono/node-server` (not an
      outbound call), two `fetch()`s in the **browser** client bundle
      (livereload poll + `/search`, both same-origin/loopback to the local
      preview server), and three prose "fetch" mentions in `core`'s
      `mirror/provider.ts` comments (no real call — GitHub fetching is
      server-side, off the preview path). The CLI process makes no outbound
      requests.

## 2. Packaging & distribution

- [x] **Package name**: `collab` was always a placeholder and is squatted on
      npm anyway (published 2012, `0.0.4`, abandoned but still claimed).
      **Locked on `scholia`** — the unscoped npm name is available, and the
      matching org `@scholia` is also free (reserved, unclaimed, for sibling
      packages later). *Scholia* are the marginal annotations classical
      commentators layered onto a text — anchored, multi-author notes on a
      document, which is what this is. `packages/cli/package.json`'s `"name"`
      is now `scholia` and the `bin` key is `scholia`, so the binary and the
      package share one name; the internal pnpm workspace scope (`@collab/*`)
      is a separate namespace and stays as-is. Install/run: `npx scholia
      <path>` or `npm i -g scholia`.
    - **Domain**: `scholia.live` (the `.com/.io/.dev` set was gone; `.live`
      nods at live, collaborative docs and is cheap). Site not built yet.
    - **GitHub**: deferred — `scholia` is taken as a personal *user* account,
      so no `github.com/scholia` org is possible. Staying under the personal
      account for now; pick a paired org handle later if/when it's worth it.
      npm README links must use absolute `github.com/...` URLs regardless
      (see §7).
    - **Full rebrand deferred (decided)**: all remaining "Collab" references
      get removed eventually — this is settled, just not now. Still on the
      old name: product-facing prose (README pitch, `CONTEXT.md`, `PLAN.md`,
      the ADRs), the deferred hosted commands in `cli.ts` (`[collab]` log
      prefixes, `COLLAB_*` env vars), and the internal `@collab/*` workspace
      packages. Sweep these alongside the §1 hide decision and the env-var
      renaming; ADRs get a note rather than a silent history rewrite. Not a
      v0.1 blocker — v0.1 ships Local Preview only, so the README quick start
      can already lead with "Scholia" while the deeper prose lags.
- [x] **Build step**: added `packages/cli/tsup.config.ts` +
      `packages/cli/scripts/copy-assets.mjs`. `pnpm --filter scholia
      build` now: (1) builds `@collab/local`'s browser bundle, (2) bundles
      `cli.ts` + the workspace deps it needs (`@collab/core`,
      `@collab/local`, `@collab/client` — via `noExternal: [/^@collab\//]`)
      into `dist/cli.js` **as ESM**, (3) copies the browser bundle into
      `dist/assets` alongside it. `bin` points at `dist/cli.js`;
      `package.json` picked up `"files": ["dist"]`, `"engines": {"node":
      ">=22"}`, and dropped `"private"`/reset to `"version": "0.1.0"`.
      `pnpm start` (tsx from source) is untouched for local dev iteration.
  - Hit a real crash first: `gray-matter` (a transitive `@collab/core` dep,
    used for frontmatter parsing) does a plain `require('fs')`, and
    esbuild's own shim for bundled `require()` calls in ESM output falls
    back to `typeof require !== "undefined"`, which is always false in
    genuine ESM — no `require` global exists there, regardless of the
    module id being a string literal. It threw `Dynamic require of "fs" is
    not supported` at startup. `platform: "node"` alone doesn't fix this;
    esbuild never auto-injects `createRequire`. Fixed two ways: (1) a
    `banner()` in `tsup.config.ts` that defines a real `require` via
    `node:module`'s `createRequire(import.meta.url)` before esbuild's shim
    runs, so its `typeof require` check is true and it uses the real one
    instead of throwing; (2) separately, dropped `gray-matter` entirely —
    swapped it for **`vfile-matter`** (`packages/core/src/util/frontmatter.ts`),
    the unified-collective-native frontmatter parser: ESM-only, deps are
    just `vfile` and the pure-JS `yaml` parser, no `fs` touch at all. The
    banner turned out to still be load-bearing regardless — verified by
    temporarily removing it post-swap and rebuilding: a *different*
    transitive dep (something in the shiki/rehype chain) does plain
    `require('process')` and hits the identical crash. So both fixes stay:
    the banner is the general-purpose guard, the `vfile-matter` swap is a
    real reduction in dependency surface (one fewer CJS/fs-touching dep,
    matches the rest of `core`'s unified/remark/rehype stack).
  - Verified end-to-end: built `dist/cli.js`, ran it against a scratch
    folder with markdown + math + a fenced code block + YAML frontmatter
    (`title:` rendered correctly as the page `<title>`), confirmed
    `/__assets/client.js` and `/__assets/katex/katex.min.css` both 200,
    ESM code-splitting intact (shiki's ~200 per-language grammars stay
    lazy `import()` chunks — `dist/cli.js` is ~1.4 MB, `dist/` 16 MB/514
    files total), cold start ~670ms across 3 runs.
  - `pnpm --filter @collab/core typecheck` and the frontmatter test suite
    (3 tests: extracts data + strips fence, no-frontmatter passthrough,
    never-throws-on-malformed-YAML) all still pass unchanged.
  - `pnpm typecheck` and `pnpm test` both still pass unchanged.
- [x] **Build self-bootstraps from clean `dist/`.** Removed all three
      workspace `dist/` dirs (`cli`, `local`, `web` — all git-ignored) and
      reran `pnpm --filter scholia build`: it rebuilt `@collab/local`'s
      browser bundle from source (498ms), bundled `dist/cli.js` (1.4 MB), and
      copied 145 files into `dist/assets`. Exit 0, nothing assumed present.
      *Caveat:* this reused the existing `node_modules`/lockfile — a truly
      fresh clone + fresh install is validated separately by the isolated
      `npm pack` install below.
- [x] **Isolated `npm pack` install verified — caught & fixed a real bug.**
      First attempt failed: the published `package.json` declared
      `@collab/client`/`@collab/core`/`@collab/local` as runtime
      `dependencies` with `workspace:*`, so `npm install` of the tarball
      outside the monorepo died with `EUNSUPPORTEDPROTOCOL` (pnpm rewrites
      `workspace:*` only on publish, and these packages are unpublished).
      Since `noExternal: [/^@collab\//]` inlines all three into
      `dist/cli.js`, they aren't runtime deps at all — **moved them to
      `devDependencies`**, leaving runtime `dependencies` = `cac` + `open`.
      Re-verified: isolated `npm install` exits 0; packed `dependencies` is
      `{cac, open}` only; isolated `node_modules` pulls in just `cac`,
      `open`, and `open`'s transitive deps — no `@collab/*`, `hono`, `shiki`,
      `chokidar`, `katex`, or `mermaid` (all bundled). Smoke run against a
      scratch `.md` (markdown + KaTeX): clean startup, `/`, `/__assets/client.js`,
      and `/__assets/katex/katex.min.css` all 200. `pnpm install` re-run to
      sync the lockfile — `pnpm-lock.yaml` is now modified (commit under §5).
      Also note: the `tsup.config.ts` header comment claims hono/chokidar
      "stay external"; that's inaccurate (they're bundled, not external) —
      worth correcting when §5/§2 rebrand touches that file.

## 3. Quality gates

- [x] `pnpm typecheck` clean — full workspace, exit 0 (after the
      dependencies→devDependencies move and the `cli.ts` flag-gating).
- [x] `pnpm test` — CI gate scoped to shipping packages (see resolution
      below); full suite covers `packages/cli/test/` (collect, provenance,
      site-link) and `packages/local/test/server.test.ts`.
      **Status (ran with `DATABASE_URL` set, Postgres on 5544 — hosted path
      NOT skipped): 319/323 passed, 0 skipped, 4 failed.** All 4 failures are
      in `@collab/server` (hosted path, out of v0.1 scope) and untouched by
      this launch's changes — pre-existing:
      - `packages/server/test/postgres-rate-limit.test.ts:38` — `retryAfterMs`
        60040 > 60000 max (looks like a flaky timing bound).
      - `packages/server/test/webhooks.test.ts:221,:291,:483` — all "expected
        imported comment to exist, received undefined" (GitHub-mirror webhook
        import path; likely one shared root cause).
      The Local-Preview-relevant packages (`cli`, `local`, `core`, `db`) are
      green. **Resolved (decided): skip the server suite for v0.1 CI.** Added
      a root `test:ci` script — `vitest run packages/core packages/cli
      packages/local packages/bridge packages/github` — that runs the shipping
      + pure packages and excludes `@collab/server` explicitly (not via the
      silent `DATABASE_URL`-unset skip). Verified green with no Postgres: **28
      files / 193 tests / 0 failed / 0 skipped**, zero `packages/server` files
      in the run. The 4 hosted-path failures are tracked here to fix before
      hosted mode ships. `.github/workflows/ci.yml` now runs `pnpm test:ci`.
- [x] Manual smoke test on macOS with the **packaged** binary (packed +
      installed to an isolated `/tmp` dir, not `pnpm collab`). 12/13 cases
      clean; 1 flagged for a product decision:
      - single `.md` → 200, heading rendered ✓
      - nested folder → root 200, `/sub/deep` 200, nav links resolve ✓
      - Entry Page folder → root 200, `README.md` renders at the dir root
        (precedence confirmed in `core`: `index.html → index.md → README.md`) ✓
      - `.mdx` (MDX on) → 200, `{1 + 2}` evaluated to `3` ✓
      - non-markdown assets → page 200, `data.txt` 200, `pic.svg` 200 ✓
      - `--no-open` → no browser launched, served fine ✓
      - `--no-mdx` → 200, `{1 + 2}` left literal (not evaluated) ✓
      - custom `--port`/`--host` → 200 on `127.0.0.1:4206` ✓
      - non-existent path → exit 1, `[scholia] not found: …` ✓
      - **port-already-in-use → now handled (decided + implemented).** An
        explicit `--port` that's taken is a hard error (exit 1: "port N is
        already in use…"); with no `--port`, the default falls back to the
        next open port **and prints a notice** ("port 3000 is in use —
        falling back to 3001"), matching Vite/Next DX (Vite's `strictPort`,
        Next's warn-on-fallback). Implemented via `strictPort` in
        `@collab/local` `StartOptions` (`server.ts` `findPort` throws when
        strict) + explicit-vs-default detection in `cli.ts`. Both paths
        smoke-verified from source.
      - *macOS only* — cross-platform is the separate item below.
- [x] Cross-platform correctness covered by CI + dev (decided). `ci.yml`'s
      `check` job now runs a matrix on `ubuntu-latest` + `windows-latest`
      (fail-fast off) — Windows exercises the platform-divergent surface
      (path handling in `core`'s path utils + the Local Preview server's
      `resolveWithinRoot`/`toUrlPath`, via the existing
      `packages/core/test/util/paths.test.ts` and
      `packages/local/test/server.test.ts`). No macOS runner: covered by local
      dev + the smoke matrix above (macOS ≈ Linux for POSIX paths, and macOS
      runners are ~10× cost for near-zero marginal signal).
      *Residual (non-blocking):* the interactive UX that CI can't exercise —
      `open` browser launch + live-reload watch on real Windows — still wants
      a one-off manual spot-check; low severity (`open` is `--no-open`-guarded)
      and not a v0.1 blocker now that Windows path correctness is gated in CI.
- [x] SIGINT and SIGTERM both confirmed: `cli.ts`'s `shutdown` handler
      closes the server and exits — process gone and port released after
      each signal. Live-reload sanity: edited a watched file under a running
      server; the server stayed up (pre/post edit both 200) and the chokidar
      watch survived without error. *Caveat:* verified at the server level
      only — the browser-side reload poll (`x-collab-livereload`) and the
      chokidar cost on a genuinely large folder still want a real browser +
      big-tree run (folds into the cross-platform manual pass below).

## 4. Docs

**Two README surfaces (decided).** The npm package page and the repo landing page
have different audiences, so they're separate files rather than one shared text:
`packages/cli/README.md` is the npm-facing doc (npm includes `README.md` in the
tarball automatically even with `"files": ["dist"]` — verified via `npm pack
--dry-run`), and the root `README.md` stays the repo/monorepo landing page. Per §7,
the npm one uses **absolute** `github.com/jtmthf/scholia/...` URLs throughout; the
root one keeps relative links.

- [x] **Root README rewritten.** Now titled "Scholia", opens with the `npx scholia
      ./docs` quick start and the name's etymology, and states up front that Local
      Preview is what ships. The hosted pitch moved into a "**Hosted mode (not
      shipped yet)**" section that says plainly the code exists (repo is at M11) but
      **none of it is in the released package**, names the `COLLAB_HOSTED=1` gate
      from §1, and points at `CONTEXT.md`/`PLAN.md`/`docs/adr/`. The package table
      now leads with `scholia` and notes that `@collab/*` is an unpublished internal
      workspace scope. Dev instructions kept but demoted to a "Development" section,
      updated to `pnpm test:ci` (§3) and `pnpm --filter scholia build` (§2).
- [x] **New `packages/cli/README.md`** — the npm page. What it is, `npx`/`-g`
      install, Node 22+, a flag table (including the §3 explicit-vs-default port
      behaviour), what renders (GFM, KaTeX, Shiki, Mermaid, frontmatter, MDX, nav,
      search, live reload), the MDX trust section, and the scope note.
- [x] **`scholia --help` verified clean.** With the §1 gate off, help lists only
      `[target]` and its five flags — no `share`/`chats`/`state`/`rotate-*`/
      `delete-site` anywhere in the output. Confirmed from both source (`pnpm
      --filter scholia start --help`) and the built `dist/cli.js`.
  - Fixed while here: `cli.version("0.0.0")` was hardcoded, so `--version` printed
    `scholia/0.0.0` for a 0.1.0 package. Now reads `version` from `../package.json`
    via `createRequire(import.meta.url)` — that specifier resolves identically from
    `src/cli.ts` under tsx and from `dist/cli.js` in the published tarball (npm
    always ships `package.json`). Going through `createRequire` explicitly rather
    than a bare `require()` matters twice: esbuild would otherwise inline the whole
    manifest into the bundle, and tsx has no `require` global for the §2 banner's
    shim to hand back. Both paths verified printing `scholia/0.1.0`.
  - *Known cosmetic, not fixed:* cac renders negated flags as `--no-open  Do not
    open the browser automatically (default: true)`. The `(default: true)` reads
    ambiguously (it's the *positive* option's default), but it's cac's built-in
    rendering for `--no-` options and suppressing it means reaching into the
    library. Left as-is.
- [x] **MDX trust boundary documented on the CLI's own surfaces.** A "MDX runs code
      on your machine" section in `packages/cli/README.md` states that `.mdx` is
      compiled and executed as Preact in the CLI process with the user's
      permissions, that `--no-mdx` disables evaluation entirely, and that plain
      `.md` is never evaluated either way — then links to ADR-0012 for why this is
      an architectural line (Local Preview is the trusted surface; hosted never
      executes MDX). Also surfaced in `--help` via a new "Notes" section, and as a
      `> [!IMPORTANT]` callout in the root README, so it's visible without opening
      the ADR.
- [x] **"What this is / isn't yet" note.** In `packages/cli/README.md`: v0.1 reads
      files off disk and serves them over loopback, no outbound requests, no
      credentials, nothing to sign up for — followed by an explicit list of what the
      larger project does that is *not* in this release (no `share`, no Threads, no
      hosted URLs, no accounts, no agent API) and a direct ask not to file bugs
      against sharing. Mirrored in the `--help` Notes section and the root README's
      hosted-mode section.
- [x] **npm package metadata** (adjacent, needed for the npm page to render):
      `packages/cli/package.json` gained `description`, `keywords`, `homepage`,
      `bugs`, `repository` (with `"directory": "packages/cli"` for the monorepo),
      and `author`. Without a `description` the npm listing and search results are
      blank.
- **GitHub URL decision:** all absolute links point at
  `github.com/jtmthf/scholia`. The repo has **no git remote yet** — this is the
  intended slug (matches the locked package name, personal account per §2), so
  creating/renaming the GitHub repo to `scholia` is now a precondition for publish.
  Tracked in §6.

## 5. Repo hygiene

- [x] **`LICENSE` added — MIT (decided).** Chosen over Apache-2.0: shortest and
      most permissive, the norm for a small npm CLI, and adoptable without legal
      review. Copyright "2026 Jack Moore". Two copies on purpose: the root
      `LICENSE` covers the repo, and `packages/cli/LICENSE` is a real copy (not a
      symlink — npm's tarball packing shouldn't have to follow one) so the
      published package carries its own license. Confirmed by `npm pack
      --dry-run`: the tarball contains `LICENSE` (1.1 kB) and `README.md`
      (4.5 kB) alongside `dist/`, even though `"files"` is just `["dist"]` — npm
      always includes both. Also added the missing `"license": "MIT"` field to
      the root `package.json` and to `packages/cli/package.json`; **no package in
      the workspace had a `license` field before**, which would have drawn an npm
      warning on publish and left the npm page showing no license. The nine
      `@collab/*` packages are all `"private": true` and unpublished, so they're
      left without the field.
- [x] **Untracked files sorted.** Two of them are agent-tool scratch and are now
      git-ignored: `.opencode/` (61 MB — its own `node_modules`, lockfile, and a
      49 kB session `plan.md`) and `.playwright-cli/` (skill-dumped `page-*.yml` /
      `console-*.log` artifacts). Added under a single "agent-tool scratch"
      comment in `.gitignore`. `packages/cli/README.md` is the §4 npm page and
      **is** meant to ship — still untracked, to be included in the release
      commit. The rest of this item was stale: `AGENTS.md` and `CLAUDE.md` were
      committed in `82e32ed` and ADR-0015 in `173614b`, so nothing there needs
      sorting. `git status` untracked is now exactly `CHANGELOG.md`, `LICENSE`,
      `packages/cli/LICENSE`, `packages/cli/README.md` — all intended.
- [x] **`CHANGELOG.md` added** at repo root (Keep a Changelog 1.1.0 + SemVer),
      with an `[Unreleased]` section and the `[0.1.0]` entry. States up front that
      only the published `scholia` package is versioned and that `@collab/*` is
      internal, so the file doesn't become a monorepo-wide log. The 0.1.0 entry
      covers **Added** (the `[target]` command and its four flags — verified
      against `cli.ts:231-235`, not the checklist prose — rendering features,
      directory nav/search/Entry Page, the §3 port-fallback behaviour, the npm
      README + MDX trust boundary), **Not included** (hosted mode, gated behind
      `COLLAB_HOSTED=1`), and **Internal** (the `gray-matter` → `vfile-matter`
      swap, tsup bundling, `cac` + `open` as the only runtime deps). Dated
      "unreleased" and the compare/tag links point at `v0.1.0` on
      `github.com/jtmthf/scholia` — both resolve once §6 tags and creates the
      repo.

## 6. Release mechanics

- [x] CI gate exists — `.github/workflows/ci.yml` runs on push to `main` and
      on every PR: `pnpm install --frozen-lockfile` → `pnpm typecheck` →
      `pnpm test:ci` (GitHub Actions, Ubuntu, Node 22, pnpm 11). `test:ci` is
      scoped to the shipping + pure packages and skips `@collab/server` (see
      §3 item 2). Both steps verified green locally with no Postgres.
      *Still open:* nothing yet makes this a hard precondition for publish —
      add branch protection requiring the `check` job, and/or a publish
      workflow that `needs:` it, when publish is set up (§6 access item).
      **Note on branch protection:** required status checks would also block
      the direct-push-to-`main` flow this repo actually uses (a fresh commit
      has no check results yet), so it forces a PR workflow. Decide that
      deliberately rather than as a side effect — the `needs:`-a-publish-job
      route gates releases without changing day-to-day pushing.
- [x] **CI actually runs now, and it caught a latent break on first
      execution.** The workflow had never executed — no remote existed — so
      the config was unverified. First run (`30138433091`) failed on **both**
      matrix legs at setup: `pnpm/action-setup@v4` errors with "Multiple
      versions of pnpm specified" when `with: version:` is set alongside
      `packageManager` in `package.json`. Neither leg reached `typecheck`.
      Fixed by dropping `version:` from the workflow and letting the action
      read `packageManager`, which is the single source of truth and pins the
      exact patch (`11.7.0`) rather than floating within major 11. Re-run
      (`30138465125`) green on both legs. **This is also the first real
      validation of §3's cross-platform item** — the Windows leg had only ever
      been asserted, never executed; it now genuinely passes.
      *Cosmetic, not fixed:* Actions warns that `actions/checkout@v4`,
      `actions/setup-node@v4`, and `pnpm/action-setup@v4` target the
      deprecated Node 20 and are forced onto Node 24. Harmless today; bump the
      action majors when convenient.
- [ ] Tag the release in git (`git tag`) — repo has no tags. **Decided: wait
      until the npm publish**, so the tag matches exactly what ships and the
      CHANGELOG's `0.1.0` entry stays honestly marked "unreleased" until then.
- [ ] Decide publish access: who holds npm publish rights / 2FA on the
      account that owns the chosen package name.
- [x] **GitHub repo created: `jtmthf/scholia`**, remote added as `origin`,
      `main` pushed and tracking. Created fresh rather than renaming — the one
      candidate to rename, `jtmthf/mdttp` (the predecessor named in
      `CLAUDE.md`), is private with 0 stars and 0 forks and was created and
      pushed within the same second on 2026-06-24, sharing no history with
      this repo's commits. Nothing there to preserve; it's left untouched, so
      decide separately whether to archive it.
      **Created private** — reversible, where a public push is effectively
      not (indexed and cacheable externally the moment it lands). Flip to
      public at publish time; until then the absolute `github.com/...` links
      in the README and `package.json` still 404 for anyone but the owner,
      and Actions minutes are billed (Windows at 2× multiplier).
- [ ] GitHub release notes pointing at the CHANGELOG entry.

## 7. Post-launch

- [ ] Issue template / CONTRIBUTING pointer so early bug reports land
      somewhere specific (not just a bare issue list).
- [ ] Sanity-check the npm README rendering (relative links like
      `./CONTEXT.md` won't resolve on the npm package page — either inline
      the essentials or link to GitHub with absolute URLs).

# Launch checklist — Local Preview CLI (v0.1)

Scope: ship `collab <path>` (Local Preview, ADR-0010) as a standalone,
installable CLI. **Out of scope for this launch:** `share`, `chats`, `state`,
`rotate-share`, `rotate-token`, `delete-site` — everything that talks to
`@collab/server`. Local Preview already touches no network, DB, or token
(per `CLAUDE.md`), which is what makes it launchable on its own.

## 1. Trim the surface

- [ ] Decide: hide the hosted commands from `--help`/the binary entirely for
      this release, or leave them registered but undocumented. Leaving them
      wired in (`packages/cli/src/cli.ts`) pulls `@collab/client` and
      `open`-a-browser-to-a-server-URL flows into the published bundle for a
      release that promises none of that works yet.
- [ ] If hiding: split `cli.ts` so the local-only binary only imports
      `@collab/local` (+ `cac`, `open`) — not `@collab/client`,
      `credentials.ts`, `share.ts`, `provenance.ts`, `site-link.ts`.
- [ ] Confirm `collab <path>` makes zero network calls (grep the local
      command path for `fetch`/`http` — should be none).

## 2. Packaging & distribution

- [x] **Package name**: `collab` is taken on npm (published 2012, last
      version `0.0.4`, abandoned but still claimed). Going with **`@jtmthf/collab`**
      (personal scope) — `packages/cli/package.json`'s `"name"` field is the
      one that matters for `npm publish`; it no longer needs to match the
      internal pnpm workspace convention (`@collab/*`) used by the other
      packages, which is unaffected. Install/run: `npx @jtmthf/collab <path>`
      or `npm i -g @jtmthf/collab`; the installed binary is still named
      `collab` (that's the `bin` map key, independent of the package name).
- [x] **Build step**: added `packages/cli/tsup.config.ts` +
      `packages/cli/scripts/copy-assets.mjs`. `pnpm --filter @jtmthf/collab
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
- [ ] Confirm `pnpm --filter @jtmthf/collab build` runs clean from a fresh
      clone (no stale `dist/` from other packages assumed present) — only
      run from this checkout so far.
- [ ] `npm pack` (or `pnpm pack`) the built package and install it in an
      *isolated* directory (outside the monorepo, no workspace symlinks) to
      catch any dependency this checkout's hoisted `node_modules` was
      silently covering for.

## 3. Quality gates

- [ ] `pnpm typecheck` clean.
- [ ] `pnpm test` clean — covers `packages/cli/test/` (collect, provenance,
      site-link) and `packages/local/test/server.test.ts`.
- [ ] Manual smoke test, each on a clean checkout with the packaged binary
      (not `pnpm collab`): single `.md` file, a nested folder, a folder with
      an Entry Page, an `.mdx` file, a folder with non-markdown assets,
      `--no-open`, `--no-mdx`, a custom `--port`/`--host`, port-already-in-use
      error path, non-existent path error path.
- [ ] Cross-platform pass: macOS, Linux, and Windows (path handling via
      `resolve`/`dirname`, `open` browser launch, chokidar watch) — at least
      one real run on each, not just CI matrix green.
- [ ] Live-reload sanity check on a reasonably large folder (chokidar watch
      cost) and confirm SIGINT/SIGTERM shutdown (`cli.ts`'s `shutdown`
      handler) actually closes the server and exits.

## 4. Docs

- [ ] README currently opens with the full hosted pitch ("zero-config
      service for hosting... letting humans and AI agents collaborate...")
      and a monorepo-dev quick start (`pnpm install` → `pnpm --filter
      @collab/local build` → `pnpm collab`). Rewrite the top-level quick
      start around the packaged install (`npx <name> <path>` or `npm i -g
      <name>`), and move the hosted/share pitch to a clearly-marked
      "roadmap" or "hosted mode (coming soon)" section.
- [ ] `collab --help` output should only list flags that work in this
      release (no dangling `share`/`chats`/`state` mentions if you hid them
      per §1).
- [ ] Document the MDX trust boundary explicitly in the CLI's own docs, not
      just `PLAN.md` §1 / ADR-0012: MDX is evaluated locally on the
      author's machine, so only preview files you trust.
- [ ] One-paragraph "what this is / isn't yet" note so early users don't
      file bugs against `share` functionality that isn't shipped.

## 5. Repo hygiene

- [ ] No `LICENSE` file at repo root — required before any public npm
      publish or GitHub visibility push.
- [ ] Untracked files currently sitting in git status
      (`.opencode/plan.md`, `.playwright-cli/page-*.yml`, `AGENTS.md`,
      `CLAUDE.md`, the new ADR) — sort out what's meant to be committed vs.
      scratch before tagging a release, so the release commit is clean.
- [ ] `CHANGELOG.md` (even a one-entry v0.1.0) so early adopters have
      somewhere to look after the first update.

## 6. Release mechanics

- [ ] CI gate (typecheck + test) required to pass before `npm publish` —
      confirm this exists; none of `.github/workflows` was checked here.
- [ ] Tag the release in git (`git tag`) — repo currently has no tags.
- [ ] Decide publish access: who holds npm publish rights / 2FA on the
      account that owns the chosen package name.
- [ ] GitHub release notes pointing at the CHANGELOG entry.

## 7. Post-launch

- [ ] Issue template / CONTRIBUTING pointer so early bug reports land
      somewhere specific (not just a bare issue list).
- [ ] Sanity-check the npm README rendering (relative links like
      `./CONTEXT.md` won't resolve on the npm package page — either inline
      the essentials or link to GitHub with absolute URLs).

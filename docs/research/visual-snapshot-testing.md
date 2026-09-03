# Pixel snapshots would fail on this machine before they caught anything

Unprompted spike — no issue asked for this. The trigger was a run of purely visual
commits (`fix: reflect state in the rail and chrome affordances` (#143), `fix: floor the
article column so chrome can't starve it` (#112), `docs: … fix Agent Docs link colour`
(#163)) landing against a suite that pins rendered DOM text
(`packages/local/test/__snapshots__/*.txt`) and asserts behaviour through Playwright, but
photographs nothing. A search of the tracker for `visual`, `snapshot`, `screenshot` and
`regression` and of every issue body for `screenshot|visual regression|pixel|toHaveScreenshot|Chromatic|Percy`
returns no prior discussion, so this decides it from scratch.

Every claim below is followed to the source that owns it. Where no primary source could
be found, it says so.

## Answer

**No pixel baselines. Not "not yet, once we get to it" — not until the development
platform and the CI platform stop being two different machines, which on this repo means
a specific, nameable trigger rather than a vague someday.**

The blocking fact is measured, not argued. Rendering one Local Preview Page — real
chrome, real vendored faces, byte-identical DOM and CSS on both sides — under Chromium
from **Playwright 1.61.1** on this macOS 26.5 arm64 host and under the **official
`mcr.microsoft.com/playwright:v1.61.1-noble` image**, the two frames differ in **19,264
of 1,152,000 pixels (1.67%) at Playwright's default `threshold: 0.2`**, and 30,994
(2.69%) at `threshold: 0`. Every glyph on the Page is in the diff, and one Nav label
wraps to a different number of lines. Passing that would need `maxDiffPixelRatio ≈ 0.017`,
at which point the assertion no longer detects anything a human would call a regression.
Playwright's maintainers say this is working as intended — _"Having different screenshots
between local and docker environments is expected. You can only compare screenshots that
are taken in the same exact environment, OS, fonts, etc."_
([microsoft/playwright#20366](https://github.com/microsoft/playwright/issues/20366)) — and
the documented escape hatch closes too: the Docker image only helps if the architecture
also matches, and `--platform linux/amd64` on this Apple Silicon host crashes Chromium
inside QEMU before it can take a picture.

**The instruments Scholia actually needs are cheaper and already half-built.** Two of
them:

1. **Computed-style and geometry assertions in the existing Playwright suite**, which is
   what ADR-0039 already committed to — _"Drift is prevented by testing the invariant, not
   the numbers."_ Every colour bug in the closed-issue history (#109 resolved highlights
   staying saturated with no dark value, #163 the Agent Docs link colour, #114 the theme
   toggle never reflecting state) is a one-line `getComputedStyle` assertion that is
   deterministic on every platform, reviewable as a diff, and names the promise it
   protects. A PNG names nothing.
2. **Unconditional screenshot _artifacts_ — no baseline, no assertion.** `check.yml`
   already uploads `e2e/playwright-report` on failure. Capturing three or four named
   frames on every e2e run and uploading them always gives a reviewer (human or agent) a
   picture of what a chrome PR did, at zero flake cost, because nothing compares them.

**The tooling call, if the trigger fires:** Playwright's own `toHaveScreenshot()`, in the
existing `e2e/` suite, with **Linux-only baselines generated in CI and never on a
developer machine**. Not Vitest browser mode (it would be a second browser runtime beside
the one already installed, for the same platform problem), not Storybook (a whole
component-catalogue layer this repo has never needed), not a hosted service (Argos is the
only one whose auth survives a fork PR, and a network dependency sits badly against a
product whose default entry point _"touches no network at all"_). Lost Pixel, the
self-hosted OSS option, is **sunset** — its own README says so.

**The trigger that would change this verdict** is any one of:

- **The hosted Viewer adopts `@scholia/theme`** and the preview → share funnel has to stay
  in visual lockstep. ADR-0016 named this as the deferred cost of the editorial identity
  and it is still open; two surfaces that must look identical is a different problem from
  one surface that must look intentional.
- **A second regular contributor**, at which point "looks the same to me" stops being one
  person's memory and a shared baseline starts paying.
- **`scholia build` ships** ([#65](https://github.com/jtmthf/scholia/issues/65)), because
  a static export's whole product _is_ the rendered output, hosted where nobody will run
  the suite against it.

Until then the honest reading is that pixel baselines would cost a 4 MB binary blob in a
28 MB repository, a CI-round-trip loop to update them, and a class of flake this repo has
already paid for twice — to catch bugs that two cheaper assertions catch better.

---

## What the diff actually looks like

The measurement is the load-bearing part of this document, so here is exactly what was
run. Everything below happened in the scratchpad; no repository file was touched.

A throwaway Markdown Page was served by the real CLI
(`node tsx packages/cli/src/cli.ts <dir> --no-open --port 4399`), and its rendered output
plus `client.css`, the three vendored variable faces and `katex.min.css` were pulled down
and rewritten to relative paths, producing a self-contained static copy. Both platforms
then rendered that identical byte stream over `file://`, so the DOM, the CSS and the font
binaries are held constant and the only variable is the rasteriser.

```js
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
});
await page.goto(url, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: out, animations: "disabled", caret: "hide", scale: "css" });
```

**Same machine, three runs:** byte-identical. All three PNGs hash to
`87e5fe4c0c1101ef768a7236f19d0bbbbb855cb231648ee6af2f80e3643f03c5`. Chromium is
deterministic on a fixed host; that is not where the problem is.

**darwin/arm64 vs linux/arm64**, both Playwright 1.61.1, the second inside
`mcr.microsoft.com/playwright:v1.61.1-noble`, compared with
[pixelmatch](https://github.com/mapbox/pixelmatch) — the same library Playwright itself
uses ([`test-snapshots.md`](https://github.com/microsoft/playwright/blob/main/docs/src/test-snapshots-js.md)):

| threshold       | mismatched pixels | ratio      |
| --------------- | ----------------- | ---------- |
| `0` (strict)    | 30,994            | 0.0269     |
| `0.2` (default) | **19,264**        | **0.0167** |

The diff image is not scattered noise. It is every serif glyph in the article, every sans
glyph in the Nav, Outline, topbar and Rail, and a solid block where the Nav label _"The
Rail takes the Outline's track"_ breaks onto a different number of lines. That last one is
a genuine layout divergence, not antialiasing — which is precisely the class of change a
visual test is supposed to catch, arriving as background noise on every single run.

The PNGs also differ in size: **117,389 bytes** on darwin against **90,321 bytes** on
linux for the same 1280×900 frame. macOS's rasterisation produces more distinct colour
values, so it compresses worse. The compression ratio is itself a fingerprint of the
platform.

**Why Docker does not rescue this.** The obvious move is to run the official image
locally too. It fails on two counts. First, on Apple Silicon `docker` runs the
**linux/arm64** variant, and GitHub's `ubuntu-latest` is **x64** — the runner spec table
gives `ubuntu-latest` as 4 CPU / 16 GB / **x64**, with arm64 only under separate labels
like `ubuntu-24.04-arm`
([GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)).
Playwright's maintainers are explicit that this matters: _"It is expected that arm docker
image vs intel docker image produce different screenshots — after all, they have different
libraries/executables inside"_
([microsoft/playwright#13873](https://github.com/microsoft/playwright/issues/13873)), and
in the same thread, _"we observed color blending differences between M1 and intel."_
Second, forcing the right architecture does not work here: running the identical container
with `--platform linux/amd64` aborted with
`Assertion failed: p_rcu_reader->depth != 0 (/qemu/include/qemu/rcu.h: rcu_read_unlock: 102)`
and `SIGABRT` before Chromium finished launching. That is the same wall the reporter in
#13873 hit four years ago.

**Playwright ships no recipe for this; Vitest does.** The full source of Playwright's
visual comparison page
([`docs/src/test-snapshots-js.md`](https://github.com/microsoft/playwright/blob/main/docs/src/test-snapshots-js.md))
contains no section on cross-platform baselines, no Docker guidance, and no CI-update
workflow. What it has is a warning: _"Browser rendering can vary based on the host OS,
version, settings, hardware, power source (battery vs. power adapter), headless mode, and
other factors. For consistent screenshots, run tests in the same environment where the
baseline screenshots were generated."_

**Vitest's documentation answers the question Playwright's leaves open**, in a
_"Visual Regression Testing for Teams"_ section on its visual-regression page
([Visual Regression Testing](https://vitest.dev/guide/browser/visual-regression-testing)).
It states the problem in the same terms this document reached independently — _"Remember
when we mentioned visual tests need a stable environment? Well, here's the thing: your
local machine isn't it"_, and _"references generated on one machine will often fail on
another"_ — and then gives a concrete workflow rather than stopping at the warning:

1. **The shared environment is CI**, not a container on the developer's machine.
   _"Running the visual regression suite in a shared environment solves this problem."_
   Of the three options it lists — self-hosted runners, GitHub Actions, or a cloud service
   — its recommendation is _"Start with GitHub Actions. You can always add a cloud service
   later if local testing becomes a pain point."_
2. **Pin the browser install** before running: `npx --no playwright install --with-deps
--only-shell`.
3. **Baselines are updated by a separate, manually-triggered workflow**
   (`update-screenshots.yml`) that runs the visual suite with `--update` on a feature
   branch — never `main` — then **commits and pushes the regenerated images itself**.
   The rationale is explicit: _"You don't want to update screenshots on every PR
   automatically (chaos!). Instead, create a manually-triggered workflow that developers
   can run when they intentionally change the UI."_
4. **Visual tests are organised separately** from the rest of the suite, by glob pattern
   or Test Project.

The mechanism generalises to Playwright unchanged — `--update-snapshots` replaces
`--update`, and the rest is a GitHub Actions workflow with no tool-specific parts. Being
`workflow_dispatch` is what makes the commit-and-push step tractable: because it never
runs on `push`, it cannot retrigger itself, and because a maintainer dispatches it by
hand, it does not depend on a fork PR's read-only token.

This does not change the verdict below — a manual round trip per intentional restyle is
still a cost, and it is a cost paid _in exchange for_ the platform split rather than one
that removes it. But it does mean the split is a documented, solved workflow rather than
the open problem an earlier draft of this document called it.

## How Playwright's mechanics would land here

If the trigger fires, this is the machinery, pinned to versions. The repo is on
**`@playwright/test` 1.61.1**.

Baselines are stored beside the spec in `<spec>.spec.ts-snapshots/` and named
`{auto-generated-name}-{browser}-{platform}.png`, e.g. `example-test-1-chromium-darwin.png`;
_"Screenshots differ between browsers and platforms due to different rendering, fonts and
more, so you will need different snapshots for them"_
([test-snapshots](https://playwright.dev/docs/test-snapshots)). The `-darwin` /
`-linux` suffix is not a courtesy — it is the mechanism by which a macOS baseline and a
Linux baseline are **different files that never meet**. Committing a darwin baseline
therefore does not make CI pass; it makes a second, unverified file. The path is
overridable via
[`testConfig.snapshotPathTemplate`](https://playwright.dev/docs/api/class-testconfig),
whose tokens include `{platform}` (the value of `process.platform`), `{projectName}`,
`{testFileDir}`, `{testName}`, `{arg}` and `{ext}` — so a Linux-only layout means dropping
`{platform}` from the template and accepting that the file is meaningful on exactly one OS.

The comparison knobs, with defaults from
[`docs/src/api/params.md`](https://github.com/microsoft/playwright/blob/main/docs/src/api/params.md):

| Option              | Default      | What it means                                                                                                                                                       |
| ------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `threshold`         | `0.2`        | _"An acceptable perceived color difference in the YIQ color space between the same pixel in compared images, between zero (strict) and one (lax)"_                  |
| `maxDiffPixels`     | unset        | _"An acceptable amount of pixels that could be different."_                                                                                                         |
| `maxDiffPixelRatio` | unset        | _"An acceptable ratio of pixels that are different to the total amount of pixels, between `0` and `1`."_                                                            |
| `animations`        | `"disabled"` | _"stops CSS animations, CSS transitions and Web Animations… finite animations are fast-forwarded to completion… Infinite animations are canceled to initial state"_ |
| `caret`             | `"hide"`     | Hides the text caret.                                                                                                                                               |
| `scale`             | `"css"`      | One image pixel per CSS pixel, so a hi-dpi host does not double the file.                                                                                           |
| `mask`              | —            | Locators overlaid with a solid `#FF00FF` box (`maskColor`).                                                                                                         |
| `stylePath`         | —            | A stylesheet applied only while shooting — _"where you can hide dynamic elements."_                                                                                 |

The two defaults worth noticing are that `animations` and `caret` are **already** handled
without configuration, and that `threshold: 0.2` is a _per-pixel colour_ tolerance, not a
budget — it does not cap how many pixels may differ. The 19,264 figure above is measured
_after_ that tolerance is applied.

Updating baselines is `--update-snapshots [mode]`, with `all`, `changed`, `missing` and
`none`; running without the flag defaults to `missing`, running with it and no value
defaults to `changed` ([test-cli](https://playwright.dev/docs/test-cli)). The `changed`
enum was added in **1.50.0**, when `all` changed meaning to "update everything regardless
of difference" ([release notes](https://playwright.dev/docs/release-notes)). Under the
default `missing` mode a first-run baseline is written **and the test still fails** —
readable directly in `playwright/lib/matchers/expect.js` at 1.61.1, where the missing-file
branch returns `softError: new Error(message)` with `shouldNotRetryTest: true`. So a
missing Linux baseline fails CI rather than silently minting itself; good, but it also
means the only way to _get_ a Linux baseline is a round trip: push, fail, re-run CI with
`-u`, retrieve the artifact, commit it. For a repository whose changes are largely
agent-authored, that is three CI runs per intentional restyle.

## The tools, judged against this repo

A short comparison, because a matrix would flatter options that are not real here.

| Option                                        | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Playwright `toHaveScreenshot()`**           | The only serious candidate. Zero new dependencies — 1.61.1 is installed, the `e2e/` suite exists, the CI job exists. Inherits the whole platform problem above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Vitest browser mode `toMatchScreenshot()`** | Real and stable — [PR #8041](https://github.com/vitest-dev/vitest/pull/8041) merged 2025-07-22, shipped in `v4.0.0-beta.4`, and Vitest 4.0 (2025-10-22) _"removed the `experimental` tag from Browser Mode"_ ([Vitest 4.0 is out!](https://vitest.dev/blog/vitest-4)). The repo is on Vitest 4.1.10, so it is available today. But every `packages/*` project is `environment: "node"` with _"no DOM"_ by design (`@scholia/vitest-config`), and browser mode needs a provider — Playwright or WebdriverIO ([Browser Mode](https://vitest.dev/guide/browser/)). That is a second browser runtime installed beside the one `e2e/` already drives, to solve the same platform problem, for components that are only meaningful inside the chrome. It also stores baselines as `__screenshots__/<file>/<test>-chromium-darwin.png` — the same per-platform naming, the same trap.                                                                                                                                                                                                                                                                                           |
| **Storybook + Chromatic**                     | Storybook officially supports "Preact with Vite" ([frameworks](https://storybook.js.org/docs/get-started/frameworks)), so it is _possible_. But the Vitest addon _"does not"_ do visual regression — it points at the Visual tests addon, which _"require[s] a Chromatic account"_ and stores baselines in the cloud ([visual testing](https://storybook.js.org/docs/writing-tests/visual-testing)). So the honest shape is "adopt a component catalogue Scholia has never had, in order to adopt a SaaS." Chromatic's free tier is 5,000 billed snapshots/month with _"Free for open source… Contact us to see if you're eligible"_ ([pricing](https://www.chromatic.com/pricing)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Percy (BrowserStack)**                      | _"The free plan includes 5,000 free monthly screenshots, unlimited users, and unlimited projects"_ ([Plans and billing](https://www.browserstack.com/docs/percy/overview/plans-and-billing)). Token-based; no fork-PR story found.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Argos**                                     | The best-behaved of the hosted three. Hobby plan is _"Up to 5,000 screenshots per month"_, Pro $100/mo ([pricing](https://argos-ci.com/pricing)), and there is a sponsored OSS programme requiring a README banner and a dofollow link ([open source](https://argos-ci.com/docs/learn/billing-and-subscription/open-source.md)). Crucially it is the only one with a documented answer to fork PRs: alongside `ARGOS_TOKEN` and OIDC it offers tokenless auth — _"Argos verifies the upload by looking up the workflow run on GitHub. No configuration at all, and the only method that works on pull requests from forks"_ ([GitHub Actions authentication](https://argos-ci.com/docs/learn/integrations/github-actions-authentication.md)). That matters because GitHub runs fork PR workflows _"using a `GITHUB_TOKEN` with read-only permission, and with no access to secrets"_ ([Actions settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)) — so Chromatic and Percy would simply not run on an outside contributor's PR. |
| **Lost Pixel (self-hosted OSS)**              | **Dead.** The repository is archived, last release `v3.22.0` in November 2024, and its README leads with _"Lost Pixel is joining Figma / We are sunsetting the product and building what's next"_ ([README](https://github.com/lost-pixel/lost-pixel/blob/main/README.md)). MIT-licensed and forkable, but not a dependency to adopt in 2026.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

The hosted services do genuinely solve the platform problem — they run the browser
themselves, so there is one environment and baselines live off-repo with a review UI. The
objection is not technical. It is that Local Preview _"touches no network at all"_
(CONTEXT), Provenance is metadata-only because _"Scholia never accesses the repo itself"_
(ADR-0007), and the whole `check.yml` design is a stack you can `docker compose up`
yourself. Making the visual contract depend on a third party's account is the first
place that posture would break, and it would break it for the surface the product is
named after.

## Flake, and Scholia's two-states problem

Pixel tests are famous for flake, and the primary sources say where it comes from. Some of
it Scholia has already immunised itself against; one hazard is specific to this codebase.

**Fonts are the usual culprit and here they are not.** ADR-0016 commits to vendoring:
_"Fonts must be vendored, never fetched… ADR-0010 and CONTEXT.md commit Local Preview to
touching no network."_ The three variable faces are 116 KB of `woff2` in
`packages/theme/fonts`, served from `/__assets`. So the classic failure — a face missing on
the CI box, silently substituted — cannot happen. What differs is _rasterisation_ of the
same binary, which is exactly what the 1.67% measures. Readiness still needs awaiting;
`document.fonts.ready` is the spec-defined signal
([CSS Font Loading, `FontFaceSet.ready`](https://drafts.csswg.org/css-font-loading/#dom-fontfaceset-ready)),
and it is what the harness above used.

**Motion and caret are handled by default** (`animations: "disabled"`, `caret: "hide"`),
and `reducedMotion` is separately emulable — _"supported values are `'reduce'`,
`'no-preference'`. Defaults to `'no-preference'`."_

**Locale and timezone are not.** Both _"Default to the system"_ value
([params](https://github.com/microsoft/playwright/blob/main/docs/src/api/params.md)), and
this repo already has a scar there: `packages/local/test/layout.test.ts` redacts Comment
timestamps out of the DOM golden because _"a golden containing it would say 'Jul 28,
7:32 AM' here and '11:32 AM' in CI."_ A screenshot cannot redact — it would need `mask` on
every `.comment-timestamp`, or `stylePath` hiding them, on every frame containing a
Conversation. That is most of the interesting frames.

**And the two-states problem is real and specific.** ADR-0038 decides that the hosted
Viewer _"renders a read-only rail until it hydrates"_ — the first response deliberately
carries Conversations, Comments, authors, timestamps and Outdated state but **none** of
the actions, which appear only when the client bundle boots. Two legitimate renderings of
the same Page. `toHaveScreenshot()` handles this in the worst possible way: it _"will wait
until two consecutive page screenshots yield the same result, and then compare the last
screenshot with the expectation"_
([class-pageassertions](https://github.com/microsoft/playwright/blob/main/docs/src/api/class-pageassertions.md)).
On a fast boot it silently settles on the hydrated state; on a slow one it can settle on
the pre-hydration state and produce a diff that looks like a styling regression and is
not. **The rule, if screenshots are ever taken of the hosted Viewer: pick the state
explicitly.** Pin the first paint with `test.use({ javaScriptEnabled: false })` — the
pattern `e2e/tests/local-preview.spec.ts` already uses for server-rendered chrome — and
pin the settled state only after awaiting a control that hydration is what puts there.
Never let the retry loop choose. Today that contract is held at the DOM level by
`packages/web/test/ssr.test.ts`, which asserts the SSR'd document contains the
Conversations and none of `thread-action-btn`, `comment-action-btn`, `reaction-chip`,
`page-comment-btn` or `bring-agent-btn`, and that is a better instrument for it than a
photograph: it says _which_ controls must be absent.

One more operational hazard, from this repo's own history rather than a vendor's docs.
`e2e/playwright.config.ts` runs `workers: CI ? 1 : undefined` because concurrent workers
plus `turbo run scholia`'s child processes starved the runner into
`spawn .../node_modules/.bin/tsx ENOENT`. The e2e job is already the critical path in
`check.yml` at roughly **4m20s** of a ~4m30s wall clock, single-worker, with 64 tests.
Screenshot assertions are not free there: each one re-shoots until two consecutive frames
match, on a 4-core runner that is already the constraint.

## What is worth photographing, and what is not

If and when the trigger fires, the shortlist is small and nameable. Ordered by how much a
picture adds over an assertion:

1. **Local Preview at 1512×982, `/README.md` with one Conversation** — Nav + sheet + Rail,
   the reference arrangement ADR-0039 pins. This is the one frame that shows the measure,
   the sheet-on-desk inversion and the Rail's track at once.
2. **The same Page at 1188** — the Rail as an overlay over the annotated passage, which is
   the arrangement ADR-0039 explicitly reasons is _"right narrow and wrong wide"_ and the
   one nobody looks at by hand.
3. **A Rail holding all three attention groups** — Open, Resolved and Outdated
   (`@scholia/ui`'s `Rail` + `ConversationCard`), in both themes. #107, #117 and #109 all
   lived here.
4. **The Composer open over a selection**, which #106 showed can open in dead space or
   cover the passage it quotes.

Four frames × two themes = 8 baselines. At the measured **86–111 KB** per Linux PNG of
this chrome (1280×900: 90,321 B; 1512×982: 96,750 B; 1512×982 `fullPage`: 111,207 B;
1188×900: 86,052 B), that is roughly **0.8 MB** committed, against a **28 MB** `.git`
today. Tolerable. The number that is not tolerable is the _churn_: PNG is already
compressed, so git stores each revision whole and packs nothing away. Every intentional
restyle rewrites all eight — ADR-0016's identity work, ADR-0039's grid rewrite and #157's
token move would each have added another ~0.8 MB of permanently-resident blob. Ten such
changes is a third of the current repository. Git LFS moves the problem to a service and
is not worth it at this scale; the discipline that works is keeping the count near eight
and never reaching for `fullPage`, which pins the whole article body — prose that changes
for reasons that have nothing to do with chrome.

**What should stay a DOM-text golden, permanently.** The four files in
`packages/local/test/__snapshots__/` are not a weaker version of a screenshot; they are a
different instrument, and the better one for what they do. Their own header records why:
they _"were captured from the string-template `layout.ts` this file's subject replaced
(issue #25), before the Preact SSR rewrite, and survived it byte for byte."_ A pixel
baseline would have shown zero diff across that rewrite too — and told a reviewer nothing.
The text golden showed that _no element, attribute or class moved_, in a diff a human can
read in a pull request. Structure, escaping, ordering, presence of the hydration boundary:
text. Colour, spacing, weight, wrapping: assertion first, photograph only if an assertion
genuinely cannot say it.

**And what should be an assertion rather than either.** Every one of the recent visual
fixes reduces to a statement about a computed value, and each of those is deterministic on
every platform:

- The Agent Docs link colour (#163) and the resolved-highlight dim (#109) —
  `getComputedStyle(el).color` / `.backgroundColor` against the `@scholia/theme` token.
  #75 (_"`@scholia/ui`'s palette contract has no shared source"_) is the same complaint
  from the other side and would be closed by the same test.
- The theme toggle reflecting state (#114) — already covered, by
  `local-preview.spec.ts`'s `toHaveClass(/\bdark\b/)`.
- The article floor (#112) and the reading measure (#122) — already covered, by the
  `boundingBox().width >= 464` and `scrollWidth` assertions ADR-0039 generalises into
  _"content track ≥ 780px at every width above the mobile breakpoint."_

That last one is the whole argument in miniature. ADR-0039 rejected pinning numbers
because _"CSS media queries cannot read custom properties — so any breakpoint is a
hardcoded restatement of the tokens that will drift again."_ A pixel baseline is the
maximal hardcoded restatement: it pins every number in the design at once, cannot say
which one moved, and has to be regenerated whenever any of them changes on purpose. On a
repository that has already decided to test promises instead of figures, it is the wrong
shape of instrument — before you even get to the fact that it would not run on the machine
this was written on.

## Sources

- Playwright visual comparisons, raw doc source — <https://github.com/microsoft/playwright/blob/main/docs/src/test-snapshots-js.md>
- Playwright option defaults (`threshold`, `animations`, `caret`, `mask`, `stylePath`, `reducedMotion`, `locale`, `timezoneId`) — <https://github.com/microsoft/playwright/blob/main/docs/src/api/params.md>
- `toHaveScreenshot` retry semantics — <https://github.com/microsoft/playwright/blob/main/docs/src/api/class-pageassertions.md>
- `snapshotPathTemplate`, `updateSnapshots`, `ignoreSnapshots` — <https://playwright.dev/docs/api/class-testconfig>
- `--update-snapshots [mode]` — <https://playwright.dev/docs/test-cli>
- `changed` mode added in 1.50.0 — <https://playwright.dev/docs/release-notes>
- Missing-baseline behaviour — `playwright/lib/matchers/expect.js` at 1.61.1 (installed in this repo)
- Cross-platform/architecture rendering, maintainer statements — <https://github.com/microsoft/playwright/issues/20366>, <https://github.com/microsoft/playwright/issues/13873>
- Official Docker image and tags — <https://playwright.dev/docs/docker>
- Vitest visual regression testing — <https://vitest.dev/guide/browser/visual-regression-testing>
- Vitest browser mode providers — <https://vitest.dev/guide/browser/>
- Vitest 4.0 release (Browser Mode stable, VRT added), 2025-10-22 — <https://vitest.dev/blog/vitest-4>
- `toMatchScreenshot` implementation PR — <https://github.com/vitest-dev/vitest/pull/8041>
- Storybook supported frameworks (Preact with Vite) — <https://storybook.js.org/docs/get-started/frameworks>
- Storybook Vitest addon (no native VRT) — <https://storybook.js.org/docs/writing-tests/integrations/vitest-addon>
- Storybook Visual tests addon (requires Chromatic) — <https://storybook.js.org/docs/writing-tests/visual-testing>
- Chromatic pricing / OSS programme — <https://www.chromatic.com/pricing>
- Percy free plan — <https://www.browserstack.com/docs/percy/overview/plans-and-billing>
- Argos pricing — <https://argos-ci.com/pricing>
- Argos OSS programme — <https://argos-ci.com/docs/learn/billing-and-subscription/open-source.md>
- Argos GitHub Actions authentication (tokenless works from forks) — <https://argos-ci.com/docs/learn/integrations/github-actions-authentication.md>
- GitHub fork PR permissions (read-only token, no secrets) — <https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository>
- GitHub-hosted runner specs (`ubuntu-latest` is x64) — <https://docs.github.com/en/actions/reference/runners/github-hosted-runners>
- Lost Pixel sunset notice, archived repository, MIT — <https://github.com/lost-pixel/lost-pixel/blob/main/README.md>
- `FontFaceSet.ready` — <https://drafts.csswg.org/css-font-loading/#dom-fontfaceset-ready>

### Not sourced primarily

- **Percy's paid tier prices.** `percy.io/pricing` returned only a page title and
  `docs.percy.io/docs/pricing` 404s. Only the free-tier figure could be pinned, from
  BrowserStack's own docs. The paid numbers in circulation are secondary and are omitted
  rather than repeated.
- **A first-party recipe for macOS-developer / Linux-CI baselines, from _Playwright_.**
  Playwright's own documentation offers none. Vitest's does — see "Visual Regression
  Testing for Teams" above — and that recipe is cited rather than paraphrased. (An earlier
  revision of this document claimed no first-party recipe existed anywhere. That was
  wrong: the section is on the Vitest page this document already cited.)
- **Chromatic's OSS eligibility criteria.** The pricing page says only _"Contact us to see
  if you're eligible"_; no published criteria were found, unlike Argos's.

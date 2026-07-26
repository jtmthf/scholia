# The reading surface is editorial, not a dashboard

## Status

accepted

> **Update (2026-07-26):** `@collab/*` below refers to what is now `@scholia/*`
> (workspace/env-var rename, issue #15). Left as originally written.

## Context & Decision

Local Preview's chrome was GitHub Primer's markdown CSS with a three-column shell
around it — `#1f2328` on `#ffffff`, `#d0d7de` rules, `#0d1117` in dark, the
`-apple-system` stack throughout. It rendered correctly and read as a README, because
that is what it was. The obvious upgrade path is the one every current docs framework
has already taken: Geist or Inter, neutral grays, raised sidebar panels, tinted cards.
Taking it would have made Scholia a slightly-worse fumadocs.

We chose an editorial direction instead, on the grounds that the product is named for
the marginal annotations ancient commentators wrote alongside classical texts, and that
this is the one place the naming can do real work:

1. **Serif prose, sans chrome.** Source Serif 4 for the article body, Public Sans for
   Nav / Outline / topbar, Fira Code for code. Three variable faces, vendored as woff2.
2. **Rubric palette.** Warm paper (`#faf8f5` / `#16150f`) with a desaturated oxblood
   accent (`#a03328` / `#d97757`) — rubrication, the red ink medieval scribes used for
   headings and marginal notes. Reserved for links, active Nav, the Outline rail, and
   nothing else.
3. **Sheet on desk.** The page backdrop is the darker warm tone and the article sits on
   paper as an actual sheet with a hairline rule and no shadow; Nav and Outline sit
   unfilled on the backdrop. This inverts the conventional arrangement, where the
   sidebar is the raised surface and the content is flat.
4. **Code blocks inherit the sheet's surface.** `defaultColor: false` already emits
   shiki token colors as CSS variables, so the theme background is separable from the
   token palette. We drop the background and take Rosé Pine tokens
   (`rose-pine-dawn` / `rose-pine-moon`) for their low saturation — GitHub's keyword red
   `#d73a49` sits close enough to the accent that syntax and links would read as one
   signal.

We rejected the tech-sans consensus (Geist + JetBrains Mono is fumadocs' exact pairing;
Inter is the default-modern choice) because adopting it would spend the identity budget
on looking like everyone else. We rejected keeping the system stack because that texture
is most of what read as basic in the first place.

## Consequences

- **Fonts must be vendored, never fetched.** ADR-0010 and CONTEXT.md commit Local
  Preview to touching no network, so Google Fonts is unavailable by construction. The
  faces ship in the tarball via the same mechanism that already vendors 1.2 MB of KaTeX
  woff2 — roughly 260 KB more.
- **A new `@collab/theme` package owns tokens and `@font-face`**, with relative
  `url("./fonts/*.woff2")` so both esbuild (Local Preview) and Vite (the Viewer) rewrite
  and emit the binaries. `@collab/core` was the wrong home: it is pure domain logic.
  Publishing cost is nil — `packages/cli` inlines `@collab/*` via `noExternal`.
- **The hosted Viewer is now committed to follow.** `packages/web` carries its own
  divergent copy of the Primer tokens with no dark-mode toggle. Until it adopts
  `@collab/theme`, the preview → share funnel shows two different-looking products.
  This is the main cost of the decision and it is deferred, not avoided.
- **`SHIKI_THEMES` lives in `@collab/core`**, so the code-block change reaches the
  hosted render path too. Already-rendered Versions are unaffected — hosted Pages are
  static HTML (ADR-0012) — so the change lands per-Version rather than retroactively.
- **The GitHub alert palette needs retuning.** Caution is currently `#cf222e`, close
  enough to the oxblood accent to be confusable; it moves to a cooler crimson so an
  alert never reads as a link.
- Reversing this means replacing the token layer, dropping three font dependencies, and
  re-theming shiki. Cheap in isolation, but the identity is the point — the cost of
  changing course is that there is nothing distinctive left.

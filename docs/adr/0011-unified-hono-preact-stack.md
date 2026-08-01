# Unified Hono + Preact stack; mdttp folded in; meta-framework deferred

## Status

accepted (supersedes the Fastify + React choices in PLAN §1)

> **Update (2026-07-26):** "collab"/`@collab/*` below refers to what is now
> named Scholia/`@scholia/*` (workspace/env-var rename, issue #15). Left as
> originally written.
>
> **Update (2026-07-29):** the "interactive data-cache SPA" described below is now
> built (issue #26). The specifics this ADR left open, for the record:
>
> - **Query cache:** `@tanstack/react-query`, on Preact via a `react` →
>   `preact/compat` alias. The alias must also apply to the server bundle, so
>   react-query is listed in `ssr.noExternal` (aliases don't reach externalized deps)
>   and inlined in `vitest.config.ts` for the same reason.
> - **Router:** `preact-iso` — the Preact team's, ~1kB, and isomorphic, which is what
>   this ADR's SSR requirement needs. Its URL matcher is an internal API, so
>   `packages/web/src/routes.ts` owns the pattern, its inverse, and the server-side
>   match together.
> - **SSR:** a Hono route in `@scholia/web` itself, still a separate origin from the
>   API and reading it over HTTP — the viewer holds no database credentials. Dev runs
>   through `@hono/vite-dev-server`; production runs two Vite builds, client then
>   SSR, so both halves go through Vite and the alias holds either way.
> - **The document is a Preact component,** not an `index.html` Vite transforms —
>   the same idiom as the Local Preview chrome, so "Preact everywhere" now reaches
>   `<html>` on both surfaces. Dev and production differ only in which asset URLs it
>   emits.
> - **"SSRs the shell and public Threads, then hydrates" is literal.** Everything
>   keyed to _who_ is reading — Viewer identity, the Owner token, private Chats,
>   `mine` affordances — is in `localStorage`, which the server cannot see, so it
>   renders after hydration. The SSR'd markup is exactly what an anonymous
>   first-time reader sees, and hydration matches it rather than correcting it.
>
> The comment layer moved out to `@scholia/ui` in the same change (ADR-0030).

## Context & Decision

collab (greenfield, design-only) and mdttp (a shipping local markdown dev server) were
designed independently and picked different stacks: mdttp on **Hono + Preact**, collab's
PLAN on **Fastify + React + Vite**. Merging them into one monorepo forces a single
architecture rather than carrying both.

We unify on **Hono** (server) and **Preact** (view), everywhere:

- **Server:** Hono for the local-preview server, the hosted REST API, and the content
  origin. Web-standard `Request`/`Response` make the local and hosted servers one idiom;
  built-in SSE covers live-reload now and push later; it deploys to Cloudflare Workers,
  matching the PLAN's R2 content-origin/edge grain.
- **View:** Preact everywhere — the SSR'd chrome (`preact-render-to-string` on a Hono
  route) and the MDX runtime (already Preact in mdttp). One view runtime across chrome
  and content rendering.
- **Hosted viewer:** an interactive data-cache SPA — Preact + Vite + TanStack Query +
  a small router — that SSRs the shell and public Threads, then hydrates the comment
  layer. `hono/jsx` is reserved for purely-static routes (e.g. `/agent-docs`).
- **Shared `@collab/core`:** render pipeline, Nav, Entry Page, search, frontmatter and
  headings extracted from mdttp; collab's source map + anchoring added alongside.

## Considered Options

- **A React meta-framework (Next.js / TanStack Start) for the hosted side.** Rejected for
  v1: it can't host the local CLI tool (forcing two architectures — the duplication the
  merge exists to remove), the cross-origin content is a blob server not app routes, and
  the viewer's per-Viewer data is gated behind a client-held localStorage secret (Viewer
  is minted client-side) with `noindex` content in an iframe — so server route-loaders,
  a meta-framework's headline feature, are the part this app can use _least_. The
  valuable part (a typed client data layer) is TanStack **Query**, which is framework-
  agnostic and decoupled from the meta-framework.
- **`hono/jsx` for the viewer.** Attractive for native SSR and zero extra deps, but its
  client runtime is young, it has no mature data-layer support (TanStack Query doesn't
  target it), and MDX-on-`hono/jsx` is unproven — and if MDX stays Preact while the
  chrome is `hono/jsx`, you carry two view runtimes anyway. The viewer is a genuinely
  interactive data-cache SPA (rail, optimistic mutations, live updates, anchor markers),
  so the mature runtime wins; `hono/jsx`'s edge (SSR is one dep) saves little since
  Preact SSR on a Hono route is trivial.

## Consequences

- Fastify and React both drop out of the PLAN; mdttp's Preact MDX runtime is kept.
- We own routing, SSR wiring, and code-splitting ourselves (Vite-native) instead of
  getting them from a framework — a bounded cost for a single-shell viewer.
- The iframe boundary is a clean seam: if the hosted _product_ later grows route-and-
  load-heavy surfaces (accounts, dashboards, teams, marketing), a Vite-based framework
  can be introduced for _that_ app only, without disturbing the viewer, the content
  origin, or the local tool. That is the revisit trigger.

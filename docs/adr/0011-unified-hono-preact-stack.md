# Unified Hono + Preact stack; mdttp folded in; meta-framework deferred

## Status

accepted (supersedes the Fastify + React choices in PLAN §1)

> **Update (2026-07-26):** "collab"/`@collab/*` below refers to what is now
> named Scholia/`@scholia/*` (workspace/env-var rename, issue #15). Left as
> originally written.

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
  a meta-framework's headline feature, are the part this app can use *least*. The
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
- The iframe boundary is a clean seam: if the hosted *product* later grows route-and-
  load-heavy surfaces (accounts, dashboards, teams, marketing), a Vite-based framework
  can be introduced for *that* app only, without disturbing the viewer, the content
  origin, or the local tool. That is the revisit trigger.

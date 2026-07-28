# `scholia build` emits static HTML, not a Preact app

## Status

accepted

Amends the final consequence of [ADR-0012](./0012-hosted-pages-are-always-static-html.md) and
supplies the missing output decision for [ADR-0023](./0023-scholia-renders-its-own-docs.md).

## Context & Decision

ADR-0012 recorded, as a consequence rather than a decision, that a future `collab build` would
be "two things sharing one compile front-end: an _export_ path that emits a deployable Preact
app for hosting **elsewhere**, and the _share_ path that always flattens to static HTML." The
Preact-app half was inherited from mdttp's roadmap and never re-examined. ADR-0023 then made
`scholia build` a commitment with a deadline — it is how `scholia.live` ships — without settling
what it emits.

**`scholia build` emits static HTML.** Build and share now share their output shape as well as
their compile front-end, and differ only in destination.

The reason the Preact target looked necessary was interactivity: a static folder of HTML seemed
to imply full page loads and no app-like navigation. That is no longer true. Local Preview's
live-reload already performs a same-document, scroll-preserving DOM swap — it fetches a URL,
parses the response and replaces `.markdown-body`, `.outline`, `.nav-pane`, `.page-header` and
`.colophon`. Generalising that swap to link clicks (ADR-0028) gives app-like navigation over
**plain files on a CDN**, because the client only ever fetches a URL and reads elements out of
the response. It does not care whether a server rendered that HTML a moment ago or a build wrote
it to disk last Tuesday.

So the Preact target's distinguishing benefit evaporates, while its costs stay: a second output
format to maintain, a hydration story, an app bundle, and a hard dependency on the Preact SSR
prefactor (#25) landing first — which would put `scholia.live` a long way out, behind work that
Conversations also wants.

Conversations on an export are **read-only**. The Sidecar is append-only YAML in the repository
(ADR-0019), so at build time the export reads it and renders its Conversations as static,
anchored threads. Anchors resolve during the build against content that cannot subsequently
drift, which makes this strictly easier than live resolution. Posting needs a backend; reading
does not. The export format should be designed so the static comment layer can later be swapped
for a live client talking to a hosted server, but that upgrade is not scheduled.

## Consequences

- The docs site for a commenting tool can show real comments. ADR-0023's dogfooding argument was
  otherwise self-defeating: `scholia.live` would have demonstrated everything about Scholia
  except the product.
- Hosting the docs as a genuine hosted Site is not an alternative today — Owner-bound custom
  domains are explicitly out of v1 scope (CONTEXT "Site"), so `scholia.live` cannot be a Share
  URL yet.
- `scholia build` is unblocked from #25. It reuses `renderPage` as it stands and needs no
  Preact, which is what lets it ship behind Conversations rather than behind a refactor.
- One output format across build and share means a bug in the emitted HTML is one bug, found by
  whichever path exercises it first.
- Read-only Conversations are a visibly partial experience, and a visitor who tries to reply on
  `scholia.live` will be disappointed. Accepted: this is the same dogfooding bargain ADR-0023
  already struck, and the gap argues for the hosted upgrade in the language a roadmap
  understands.
- If an export ever genuinely needs client-side behaviour that server-rendered HTML cannot
  express, this is the ADR to supersede. Nothing in the current feature set does.

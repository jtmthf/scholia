# The hosted viewer renders a read-only rail until it hydrates

## Status

accepted

Answers the question [ADR-0034](./0034-local-preview-writes-without-javascript.md) left
open when it scoped the form-post write path to Local Preview (issue #111). Amends
[ADR-0031](./0031-local-preview-renders-page-content-in-the-chrome-document.md) for the
hosted surface, and is scoped by [ADR-0011](./0011-unified-hono-preact-stack.md) (the
viewer is SSR'd, not a static SPA) and
[ADR-0030](./0030-shared-comment-layer-as-its-own-package.md) (what the shared layer may
know).

## Context & Decision

`@scholia/web` server-renders the same `Rail` as Local Preview, through the same port, and
so inherited exactly the problem ADR-0034 fixed locally: Reply, Resolve, Promote, Delete,
the six reaction chips, "Comment on this page" and "Bring your agent" all appeared in the
first response and did nothing when clicked — no form, no feedback, no disabled state —
until the client bundle booted.

ADR-0034 did not extend its fix here, and named why: **a hosted write carries credentials
the server render does not have.** The Owner token and the anonymous Viewer both live in
the reader's `localStorage`, deliberately (CONTEXT "Viewer"; a Viewer is minted on the
reader's first _action_, never eagerly, and never just to look). The server cannot mint one
on their behalf without either inventing a cookie-borne server-side identity or minting
eagerly for anyone who loads a Page — both of which are decisions about identity, not about
markup.

**So the server supplies a port that can only read, and the controls are not rendered until
hydration puts them in.**

This costs the thing ADR-0031 objected to: **the rail changes shape at hydration.** We
accept it here and not locally, because the two surfaces differ in what a reader without
JavaScript can do at all. Local Preview renders content in the chrome document, so a
selection is a live gesture and the Sidecar is a file on the reader's own disk — nothing
but unbuilt code stands between a POST and an append. Hosted content is a sandboxed
cross-origin iframe (ADR-0003) reached only over the postMessage bridge, so selecting,
anchoring and highlighting are already impossible without JavaScript. A hosted rail that
could write but not anchor would offer a reader half a product; one that only reads offers
them the whole of what that surface honestly has.

### The mechanism is the port's existing rule, not a new one

`CommentsPort` already says an absent method is a surface the consumer doesn't have. Two
small things were missing for that rule to carry the whole rail:

- **`addComment` became optional**, like every other method. It was the one verb the layer
  assumed, so Reply rendered unconditionally.
- **`Rail`'s `onNewPageComment` became optional**, like `onBringAgent`. The rail's own two
  entry points are writes, and a surface that cannot write should not offer them.

There is no forked component code and no hosted-only branch inside `@scholia/ui`: the same
components render a reading surface or a writing one, decided entirely by what the consumer
hands them. `useHydrated` is the hosted consumer's switch, with the same
false-on-the-server-and-on-the-first-client-render shape the identity hooks already use, so
hydration matches the markup it starts from (ADR-0011).

## Considered Options

- **Extend ADR-0034's form path to hosted, carrying the Viewer through the POST.**
  Consistent across both consumers, and the only option that makes a hosted no-JS reader
  able to write. Rejected for now on cost and on scope: it needs a server-side answer for a
  Viewer who has not been minted — a cookie, or minting on first post — plus a form-borne
  Owner token and a CSRF posture, which is an identity decision rather than a rendering
  one. It stays open; nothing here forecloses it, because the surface it would light up is
  the same `formAction` the port already declares.
- **Render the controls disabled, with an explanation.** Honest, and it keeps the rail's
  shape stable through hydration. Rejected for the same reason ADR-0034 rejected it: it
  puts permanently-disabled UI on every card of the one surface the product is about, and
  for the reader who never gets JavaScript it is a worse answer than a clean reading
  surface.
- **Keep the inert port and accept the silence.** The status quo, and the thing issue #111
  was filed to stop being silently true.

## Consequences

- **The hosted rail gains its controls at hydration**, so the first paint and the settled
  page differ. Conversations, their Comments, authors, timestamps, sections and Outdated
  state are all in the first response and do not move — what appears is the row of actions.
- **Every `CommentsPort` method is now optional.** A consumer that supplies none of them is
  a valid, meaningful port, and `@scholia/ui` renders it as a reading surface. Local
  Preview is unaffected: it supplies everything the Sidecar can write, plus `formAction`.
- **A hosted reader with JavaScript disabled cannot write**, and now says so by not
  offering to. Anchoring already required a live DOM there (ADR-0003), so this makes the
  surface's real capability visible rather than reducing it.
- **`packages/web/test/ssr.test.ts` pins it**: the SSR'd document contains the
  Conversations and none of `thread-action-btn`, `comment-action-btn`, `reaction-chip`,
  `page-comment-btn` or `bring-agent-btn`.

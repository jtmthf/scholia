# Local Preview navigates by swapping server-rendered HTML

## Status

accepted

Refines [ADR-0011](./0011-unified-hono-preact-stack.md) and resolves the apparent conflict with
issue #25's stated non-goal.

## Context & Decision

Local Preview is a multi-page app: every link is a real navigation that discards the document,
loses nav-pane scroll position and re-runs every script. Issue #25, which moves the chrome to
Preact SSR, states plainly that this "is not a step toward making Local Preview a client-rendered
SPA — ADR-0011 and the Q12 reasoning both reject that, because a blank frame while JS boots would
regress the only thing currently shipping."

**Link navigation in Local Preview swaps server-rendered HTML into the current document, and both
that swap and live-reload are wrapped in `document.startViewTransition()`.**

This looks like the thing #25 rules out. It is not, and the distinction is the whole decision.
What #25 rejects is client-_rendered_: a shell that boots, fetches JSON and renders the page in
the browser, showing a blank frame first. What this does is fetch a **fully server-rendered HTML
document** and move elements from it into the live one. Every page is still rendered by the
server, in full, before it is sent. First paint is unchanged — a cold load is exactly the
server-rendered document it is today. There is no hydration boundary, no client-side renderer,
and nothing to boot before content is visible. Disable JavaScript and every link still works,
because they remain ordinary `<a href>` elements.

The decisive practical fact is that this machinery already exists and is in production. Live
reload (`packages/local/src/client/main.ts`) fetches `location.href`, parses the response, and
replaces `.markdown-body`, `.outline`, `.nav-pane`, `.page-header`, `.colophon` and the embedded
source script, preserving scroll — with `location.reload()` as its catch-all fallback. The delta
to navigation is: take a URL parameter instead of `location.href`, add `history.pushState`, and
scroll to top instead of preserving position. Rather than build a second navigation path beside
it, the two collapse into one swap function with two call sites.

`startViewTransition` then wraps both. It is progressive: where unsupported, the swap happens
without animation and nothing else changes.

## Consequences

- Persistent chrome stops flashing. The topbar, nav pane and Outline survive navigation, which is
  most of what "SPA-like" actually means to a reader.
- Local Preview takes on the obligations of client-side routing: back/forward via `popstate`,
  focus management, and route-change announcements for screen readers. These are real, they are
  easy to get wrong, and they are the genuine cost of this decision.
- The existing `location.reload()` fallback covers a failed swap, so the degraded path is a
  normal page load rather than a broken one.
- The swap client works against any origin serving the same HTML shape — including a static
  export on a CDN, which is what lets ADR-0027 drop the Preact-app target.
- #25 remains valid and unchanged in scope. It swaps the templating mechanism behind these same
  selectors; a Preact-rendered shell is swapped the same way a string-templated one is.
- Selector coupling is now load-bearing in two places instead of one. The set of swapped
  selectors is effectively an interface between the layout and the client, and #25 must preserve
  it or update both sides together.

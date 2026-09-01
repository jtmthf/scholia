# Local Preview writes without JavaScript, through form posts

## Status

accepted

Amends [ADR-0031](./0031-local-preview-renders-page-content-in-the-chrome-document.md),
which decided the rail is server-rendered and recorded the opposite reasoning about what
the controls on it should do. Scoped by
[ADR-0020](./0020-hexagonal-application-layer.md) (the verbs) and
[ADR-0030](./0030-shared-comment-layer-as-its-own-package.md) (what the shared layer may
know).

## Context & Decision

ADR-0031 made the comment rail the page's only hydration boundary and promised that **a
reader with JavaScript disabled still sees every Conversation**. `layout.tsx` delivered
that with an SSR port whose every method rejects — deliberately, and with a stated reason:
a control the server left out would have to appear when the client hydrates, which is a
rail that changes shape under the reader.

QA against 0.2 found what that costs. With the client bundle blocked, the rail renders
completely and correctly, and then Reply, Resolve, Delete, Promote, Edit and all six
reaction chips do nothing when clicked — no form, no feedback, no disabled state. The rail
keeps its shape by lying about what it can do.

There were two ways out of that, and ADR-0031 only considered one of them. **We make the
controls work.**

### Every Conversation-scoped verb is a form post

Reply, resolve/reopen, react/un-react, edit, delete (a Comment and a whole Conversation),
promote, and commenting on the Page are each reachable as a `<form>` the server rendered.
The client keeps the handlers it has and `preventDefault`s the submit, so the markup is the
same on both sides and hydration has nothing to reshape — which is ADR-0031's constraint,
satisfied rather than traded away.

**Creating an _anchored_ Conversation is not in that set, and that is not a gap.** An
Anchor is a unique text-quote taken from a selection over rendered text (CONTEXT "Anchor");
the selection is a gesture only a live DOM has. A surface that cannot select cannot anchor,
and pretending otherwise would mean inventing a second anchoring path — per-heading or
per-paragraph comment links — which is exactly the second content surface ADR-0031 spent
its reasoning avoiding.

### The shared layer learns endpoints through the port, not a URL scheme

`CommentsPort` grows an optional `formAction`, returning the action, method and hidden
fields for a verb against an id. `@scholia/ui` still constructs no request and knows no
URL (ADR-0030): a consumer that supplies `formAction` has a form surface, one that omits it
does not — the same "an absent method is a surface the consumer doesn't have" rule the port
already runs on, so there is no second code path to keep in step.

### Local Preview only, and not an agent surface

The hosted viewer keeps the inert port for now. It has an API Token and a client-minted
Viewer identity in the mix (CONTEXT "Viewer"), and a form post has to carry both; that is
its own decision and its own issue, not a free consequence of this one. That issue is
#111, and
[ADR-0038](./0038-hosted-viewer-renders-a-read-only-rail-until-hydration.md) settles it:
the hosted server render supplies a port that can only read, so the controls are left out
until hydration rather than rendered inert.

The routes call the application layer (ADR-0020) rather than reaching past it, so a form
post is a third _caller_ of the verb set and not a third implementation of it. It is not an
**agent** surface, so ADR-0021's parity is untouched: parity is a claim about the CLI and
MCP, and a human's `<form>` is not a third party to it.

## Considered Options

- **Omit the action controls when JavaScript is off.** The obvious fix, and the one
  ADR-0031 rejected for a reason that still holds — the rail would change shape at
  hydration. It is also worse for the reader who never gets JavaScript: they see a document
  with no evidence that anyone can act on it.
- **Render the controls disabled, with a title explaining why.** Honest, and it fixes the
  silence. Rejected because it puts a permanently-disabled state on every card of the one
  surface the product is about, and the reader still cannot do the thing.
- **Accept no-JS as read-only by design.** Defensible hosted, where a write needs a token.
  Rejected locally: Local Preview is the zero-config entry point (ADR-0010) writing to a
  Sidecar on the reader's own disk, so nothing but unbuilt code stands between a POST and
  an append.
- **An `actionBase` prop on `Rail`, with endpoints by convention.** A smaller signature
  than `formAction`. Rejected: it puts a URL scheme inside `@scholia/ui`, which is the
  thing ADR-0030 exists to prevent.

## Consequences

- **Local Preview gains mutating routes**, so "the only write path is a client fetch" stops
  being true of it. Whatever posture the fetch path takes for a tunnelled request
  (CONTEXT "Tunnel" — guests are Viewers) the form routes must take identically; a
  capability that leaks through the no-JS door is the same leak.
- **A no-JS write is POST-redirect-GET**, so it re-renders the Page — re-reading the
  Sidecar and re-resolving Anchors, which is the work a live-reload swap already does.
- **The content-hash binding rides as a hidden field.** ADR-0031 binds a Comment to the
  hash captured at render, never re-read at submit; a form carries it the same way the
  fetch path does.
- **`port.ts`'s doc comment is corrected.** It claims "the server render supplies none of
  them", which has never been true of `layout.tsx` and is not true under this decision.
- **`SCHOLIA_E2E_NO_WEBSERVER=1 pnpm --filter @scholia/e2e e2e local-preview.spec.ts
local-comments.spec.ts` already runs with JavaScript disabled**, so the no-JS write
  path has somewhere to be tested from the day it lands.

# Local Preview renders Page content in the chrome document, and hydrates only the comment layer

## Status

accepted

Implements [ADR-0018](./0018-local-preview-hosts-conversations.md) (Local Preview hosts
Conversations) on the delivery side, and is scoped by
[ADR-0011](./0011-unified-hono-preact-stack.md), [ADR-0012](./0012-hosted-pages-are-always-static-html.md)
and [ADR-0030](./0030-shared-comment-layer-as-its-own-package.md). Does **not** settle the
question [ADR-0029](./0029-local-preview-content-origin-on-a-localhost-subdomain.md) opens.

Amended twice since — see [Amendments](#amendments). Hoisted stylesheets are now scoped to
the article, and [ADR-0034](./0034-local-preview-writes-without-javascript.md) replaces the
reasoning behind the inert SSR port.

## Context & Decision

Issue #28 makes Local Preview the comment surface: select text, write a comment, and it
persists to the Sidecar anchored to what was highlighted. Two structural questions had to
be answered to build it, and neither is obvious from the feature.

### Page content lives in the chrome document — both Page kinds

Hosted, Page content is a sandboxed cross-origin iframe (ADR-0003), and the viewer reaches
it only over the postMessage bridge. Local Preview has never had a frame: its content is an
`<article>` in the same document as its chrome, which is what lets live reload swap it, the
Outline scrollspy observe it, and — now — a selection over it be read directly rather than
messaged across a boundary.

**We keep it that way, and extend it to HTML Pages.** A `.html` file is now a Page rather
than an Asset: it renders through `ingestHtml` (parse5 + `data-sm` stamps + a Source Map),
its `<body>` is inlined into the chrome's article, and its own `<style>`/`<link>` elements
are hoisted into the chrome's `<head>`. It appears in the Nav under its `<title>`, and the
comment layer works on it with no special case, because by the time anchoring sees it there
is no difference between the two Page kinds.

The cost is stated plainly rather than hidden: **an HTML Page can restyle the chrome around
it, and its scripts run in the chrome's document.** That is a real consequence and it is
acceptable _here specifically_, because local content is the reader's own — ADR-0012 already
makes Local Preview the surface that executes MDX, which is a strictly larger grant than
running a script the reader wrote in a file they opened.

_(Amended: the styling half of that grant was narrowed — see [Amendments](#amendments).
Scripts still run in the chrome's document.)_

Issue #28 says isolation is deliberately not settled by it, and this ADR does not settle it.
ADR-0029 decided Local Preview _should_ have a genuine cross-origin content origin at
`content.localhost`, probed at runtime; that work is not done, and when it is, this decision
is what it revisits. Recording the interim shape matters because "there is no frame yet" is
otherwise indistinguishable from "we decided against a frame".

### The comment layer is the page's only hydration boundary

ADR-0011 rejects a client-rendered Local Preview: a blank frame while JS boots would regress
the only thing currently shipping. But Conversations need a live DOM — a selection, a Range,
a painted highlight — so _something_ has to run in the browser.

**The rail is server-rendered like every other piece of chrome, and the client hydrates that
exact markup.** The Nav, Outline, Colophon, breadcrumb and now the Conversations are all in
the first response; `client.js` continues to wire the rest of the page by delegation against
the DOM the server sent, and calls `hydrate()` on exactly one container. The island's first
render is deliberately identical to the server's output — the affordance a selection raises
and the composer it opens are state only a gesture can produce, so on the server they are
absent rather than hidden.

Two consequences fall out and are load-bearing:

- **A reader with JavaScript disabled still sees every Conversation on the Page.** That is
  the test that keeps this honest, and it is in the e2e suite. _(Amended: they can now act
  on them too — [ADR-0034](./0034-local-preview-writes-without-javascript.md).)_
- **The Comment's binding is captured server-side, at render.** The Page's content hash is
  computed when the Page is rendered and written onto the article element; the client hands
  it back on submit rather than the server re-reading the file. A Comment therefore binds to
  the bytes that produced what the reader was looking at (CONTEXT "Comment"), which is not
  the same thing as the bytes on disk when they pressed the button — the dominant local case
  is an agent rewriting the file while someone is mid-sentence.

### What Local Preview does not offer

`@scholia/ui` gained optional port methods for this: a method the consumer does not supply
is an affordance that is not rendered, rather than one that fails when clicked. When this
ADR was written Local Preview supplied `addComment` and nothing else, because the Sidecar
could only write `comment` events. Resolve, reopen, react, edit and delete arrived with
ADR-0032 and are supplied now; Chats (`promote`) are issue #31 and Outdated is issue #30, so
those remain absent from the local rail and unchanged in the hosted viewer.

## Considered Options

- **A same-origin iframe for HTML Pages only.** It would preserve an HTML Page's document
  boundary — its styles and scripts could not reach the chrome. Rejected: it gives Local
  Preview two content surfaces and therefore two of everything that touches content — two
  selection paths, two highlight paths, two live-reload paths — and the Outline, scrollspy
  and in-page heading links would all need a second implementation that reaches across the
  frame. A boundary worth that much complexity is the _cross-origin_ one ADR-0029 already
  specified; a same-origin frame buys a fraction of the isolation for most of the cost.
- **Serving HTML Pages raw, as today, with no comment layer.** Rejected: it fails the
  issue's acceptance criterion outright, and "comments work on some of your Pages" is a
  worse answer than the styling bleed.
- **Client-rendering the rail after mount** (fetch the Conversations, then render).
  Rejected: it would make Conversations invisible without JavaScript and add a visible
  pop-in to the one part of the page the product is about. Server-rendering costs one
  Sidecar read per Page render, which is a directory listing.
- **Re-reading the file at submit to compute the content hash.** Simpler, and wrong: it
  would record what the file said at submit rather than what the reader read, which is the
  binding CONTEXT "Comment" describes. It is also unfixable by checking, since the file can
  change between check and write — the reason issue #29 accepts optimistically.

## Consequences

- **`isDoc` now includes `.html`/`.htm`,** so an HTML file in a served tree is a Page
  everywhere Local Preview looks: Nav, Entry Page precedence, search, extension-less link
  resolution and the live-reload rescan trigger.
- **Local Preview renders through the `ingest*` functions, not `renderMarkdown`.** The
  rendered HTML gains `data-sm` stamps, which is what lets a selection over the DOM be
  mapped back to a range in the Source. The Local Preview chrome goldens moved once, on
  purpose, to record it.
- **The set of swapped live-reload selectors grew, and one element is deliberately excluded.**
  `#scholia-comments` is Preact's DOM; replacing it wholesale would tear the mounted layer
  out from under itself, so the _data_ script is swapped and the island re-renders from it.
  ADR-0028 already names this selector set an interface between the layout and the client;
  it now has a member that must not be swapped, which is a sharper obligation than before.
- **The comment layer's palette contract is answered in `@scholia/theme`'s terms.**
  `comments.css` resolves colour through variables the consumer supplies (ADR-0030), and
  Local Preview's dark mode is a class the reader toggles rather than a media query — so the
  layer's own `prefers-color-scheme` block does not fire, and the values it would have set
  are restated under `html.dark`. Issue #75 is where that contract gets a shared source.

## Amendments

### Hoisted stylesheets are scoped to the article

QA against 0.2 found that the accepted cost above is worse in degree than it is in kind. An
HTML Page carrying `body { font-family: system-ui; max-width: 40rem }` — ordinary output
from Pandoc, an exported Notion page, a design spec — hoisted verbatim and collapsed the
chrome's own `<body>` to a 640px column, two-thirds of the viewport blank and the editorial
typography gone. This ADR accepted that an HTML Page **can restyle the chrome**. It did not
intend that opening a file can make the application unusable.

Hoisted rules are therefore rewritten into `@scope (article) { … }` — or an equivalent
selector-prefixing pass where `@scope` is unavailable — so a Page's styling reaches its own
content and stops there.

This narrows the grant without reversing the reasoning that made it. The same-origin frame
was rejected for giving Local Preview two content surfaces and therefore two of everything
that touches content: two selection paths, two highlight paths, two live-reload paths, a
second Outline and scrollspy. A rewrite pass over hoisted CSS builds none of those. Real
isolation — scripts included, which still run in the chrome's document — remains ADR-0029's
job and is untouched here.

The cost of the narrowing, stated as plainly as the one it replaces: an HTML Page's `body`
and `html` rules now land on the article element, which is not the same box. A Page that
leans on `body { margin: … }` for its outer spacing reads differently inside Local Preview
than it does standalone. That is a smaller and more local surprise than the chrome
collapsing.

### The inert SSR port is replaced by a working one

The reasoning above — controls rendered but rejecting, because a control the server left
out would have to appear at hydration — is superseded by
[ADR-0034](./0034-local-preview-writes-without-javascript.md). The constraint it was
protecting stands: the island's first render is still identical to the server's output, and
the rail still does not change shape under the reader. What changed is that the server's
output is now honest — the controls are backed by form posts and work before any JavaScript
runs, rather than keeping their shape by rejecting.

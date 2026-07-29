# ADR-0030: The comment layer is its own package, above theme and below both delivery packages

- Status: Accepted
- Date: 2026-07-29

## Context

Conversations are the product, and two packages deliver them: `@scholia/web` (the
hosted viewer) and `@scholia/local` (Local Preview). Until now the comment layer —
the rail, Conversation cards, Comments, Composer, Reactions, Identity, the Promote
dialog — lived inside `@scholia/web`, roughly 820 lines of it, because the hosted
viewer got there first. Local Preview is due the same surface (issues #27, #28, #31),
so the layer needs a home that neither delivery package owns.

Importing it from `@scholia/web` was the option to rule out first, and it fails on
two counts: one delivery package would depend on another, and `@scholia/web`'s
dependency tree is a Vite app, so Local Preview — which is bundled by tsup and run
from the CLI — would drag Vite into the CLI to render a comment card.

`@scholia/theme` already sits below both, but it is CSS tokens and fonts: no view
runtime, no behaviour. The comment layer needs a layer of its own.

## Decision

**A new `@scholia/ui` package holds the comment layer.** It depends on `preact` and
nothing else — no bundler, no server, no HTTP client — which is the constraint that
makes it usable from a non-Vite consumer.

Three things follow from "nothing else", and they are the substance of the decision:

- **Data arrives as props.** The components render the `ConversationDTO`s they are
  handed. They define those shapes, because they are what renders them; each delivery
  package maps its own transport onto them.

- **Behaviour arrives as a `CommentsPort`,** injected through context. Components
  report intent (`addComment`, `setResolved`, `promote`, …); the port decides how.
  Two responsibilities sit deliberately on the port's side of the line:

  - _Identity._ Every method resolves the acting Identity itself — hosted, that means
    minting an anonymous Viewer; locally it means reading git config (CONTEXT
    "Identity"). The components only surface `displayName`, because a reader without
    one has to be asked in the Composer.
  - _Refreshing._ A method resolves when the mutation has landed and the props the
    consumer passes down reflect it. The hosted adapter invalidates its query cache;
    a consumer holding plain state refetches. The components keep no copy, so there is
    nothing for them to get stale.

- **Capabilities are booleans, not credentials.** The layer takes `canModerate`, never
  an Owner token. Optional callbacks stand in for surfaces that don't exist everywhere:
  no `onBringAgent` means no "Bring your agent" button, because Local Preview has no
  tokens to hand out; `outdatedOrigin` lets the consumer address an earlier state,
  because only hosted Sites have Versions to link to (CONTEXT "Version").

**The stylesheet ships as an export, not an import.** `@scholia/ui/comments.css` is
declared in `exports` and the components do not import it — a bare `import "./x.css"`
only means something to a bundler. Consumers include it however their build wants.

**The palette stays with the consumer.** `comments.css` resolves every colour through
variables (`--bg`, `--fg`, `--muted`, `--border`, `--chrome-bg`, `--nav-*`) that the
surrounding surface supplies, and names that contract at the top of the file. The
hosted viewer's palette and `@scholia/theme`'s editorial identity (ADR-0016) are
different palettes on purpose; the comment layer belongs to neither.

## Consequences

- Local Preview can adopt the comment layer without Vite, and without depending on
  the hosted viewer. That was the point.
- The two consumers can't drift apart in behaviour, because there is one
  implementation. They can still differ in palette, which is what we want.
- The port is the seam to keep honest. Anything hosted-only that leaks into
  `@scholia/ui` — a slug, a token, a Version ordinal used to build a URL — is the
  signal that a prop or a port method is missing.
- `@scholia/ui`'s components are rendered by `preact-render-to-string` in tests
  (`packages/ui/test`), the same idiom the Local Preview chrome uses (ADR-0011). Node,
  no DOM environment, so the workspace still has exactly one test runner setup.
- The layer is now used by an SSR'd consumer, so it must stay render-pure: no
  `localStorage`, `window`, or `matchMedia` at render time. Nothing in it reaches for
  those today, and the SSR tests in `packages/web/test/ssr.test.ts` would fail if it
  started.

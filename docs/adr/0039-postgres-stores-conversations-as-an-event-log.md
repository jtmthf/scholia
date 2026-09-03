# Postgres stores Conversations as an event log with a projected read model

## Status

accepted

Completes [ADR-0020](./0020-hexagonal-application-layer.md), which named a Postgres
`ConversationRepository` adapter that was never written, and refines its "state-stored
rows in Postgres" consequence. Amends [ADR-0035](./0035-database-owns-time.md) for the
Conversation aggregate. Scoped by [ADR-0032](./0032-conversation-state-changes-fold-deterministically.md)
(the fold) and [ADR-0019](./0019-conversation-storage-append-only-yaml-log.md) (append-only).

## Context & Decision

ADR-0020 declared `ConversationRepository` an outbound port with two adapters: the
Sidecar and Postgres. Only the Sidecar was ever written. `packages/db` declares no
`@scholia/*` dependency at all, so the hosted path cannot reach the domain even in
principle, and every Conversation verb is implemented a second time in SQL —
`repos.ts:798–1477`, roughly 700 lines, with `foldConversation` never executing on the
hosted side. The drift ADR-0020 predicted ("guaranteed drift between two implementations
of the same product") is live: both recent Conversation-domain commits landed local-only.

Three primary sources already say what should happen. The port's own docstring: "Postgres
adapts it in `@scholia/db`." ADR-0020's outbound adapter list. And `fold.ts`, which says
the fold "lives in core rather than in the Sidecar adapter" precisely because "the same
rules have to hold for a Postgres-backed stream."

We write the adapter. Specifically:

**Postgres stores an event log, and the existing tables become its projection.**
`conversation_events(id uuid pk, conversation_id, timestamp, event jsonb)` is the write
model — the document opaque, with exactly the fold's two sort keys promoted to columns,
and the event's own UUIDv7 as the primary key so dedupe is an insert conflict rather than
a convention. `conversations`, `comments`, `reactions` and `mentions` become a read model
projected from `foldConversation`, upserted in the same transaction as the append. The
projection is a cache of the fold's output, never a parallel interpretation of it, so the
rows can only ever mean what the fold says they mean — while reads stay indexed.

**The adapter lives in a new package, `@scholia/store-postgres`.** ADR-0020 put it in
`@scholia/db`, but `@scholia/db` is not an adapter: it is schema, client, and 57 functions
spanning Sites, Versions, Tokens, Viewers, GitHub mirrors and a rate limiter. Coupling all
of that to the Conversation aggregate is the wrong seam. `@scholia/db` keeps the schema,
migrations, client and non-Conversation functions and continues to declare no `@scholia/*`
dependency; `@scholia/store-postgres` depends on core (the port) and db (the tables), and
holds both the writes and the hosted reads of those tables. One module owns the
Conversation tables and nothing else touches them.

**`Identity` moves to `@scholia/core`.** It is a `CONTEXT.md` term currently defined in
`packages/db/src/schema.ts` and re-exported to the whole workspace — the domain living
inside persistence, which is the dependency direction that actually does harm. `@scholia/db`
keeps its own row-shaped type for the `jsonb` column, so a change to the domain type cannot
become a silent change to stored data format with no migration behind it. The adapter maps.

**The hosted routes call core commands directly.** They are the inbound adapter; giving them
a second `ConversationApi` to call would be the "adapter calling adapter, with a needless
hop" ADR-0020 rejected. The GitHub mirror becomes an inbound adapter on the same footing.

**Hosted-only facts stay in the adapter.** Version binding (`comments.version_id`),
`Identity`'s `tier` and `source`, and Chat ownership (`conversations.owner_viewer_id`) never
enter the port. The adapter is constructed per request with `{ siteId, viewer }` and
resolves them from that context.

**Two additions to the event vocabulary**, both forced by hosted-only concerns:

- `origin` becomes an optional field on the comment event — absent meaning native, the same
  asymmetry `author.ts` argues for `authorKind`, so the quiet case stays quiet. This is what
  lets the GitHub mirror write through the port instead of around it. `tombstoneComment`
  dissolves into `deleteComment` issued by the mirror acting as the external author.
- `reanchored { anchor, anchorStatus }` is a ninth event kind. Re-anchoring after a new
  Version currently mutates `conversations.anchor` directly, which the next re-fold would
  overwrite. It names an Anchor and a status, never a Version, so the vocabulary stays
  Version-free and ADR-0020's "Versions stay Postgres-only" holds. The Sidecar will never
  have a caller for it.

**Promotion unifies on the copy rule.** Hosted Promotion flipped a Conversation's visibility
in place and hid the unselected Comments via `comments.hidden_at`; core writes a new Thread
and leaves the Chat alone. `CONTEXT.md` documented both. The hosted rule was justified by a
fact about the schema — "a Conversation's visibility is its own and can change" — rather
than by anything a person wants, and no reader should lose their Chat's history because
their docs happen to be hosted. `hidden_at` and its five `isNull` guards come out with it.

**The cutover is atomic.** A projection written by the fold and a `repos.ts` function writing
a row directly cannot both own the same tables: the row without an event behind it is erased
by the next re-fold. All five inbound paths — `routes/conversations.ts`, the Chats routes,
owner moderation, the GitHub mirror, and `migration.ts` — move in one change. A tracer bullet
through `comment` lands first to de-risk the design, not to ship incrementally; there is no
hosted data and no users to ship to.

**A shared contract suite is the proof.** `ConversationRepository` gains a contract suite in
`@scholia/core`, exported as a test subpath beside the existing `./test/helpers/anchor-corpus.js`,
run against the in-memory stub, the Sidecar and Postgres. The seam stops being hypothetical
at the moment a second production adapter pulls on it, and the suite is what says so.

## Considered Options

- **The adapter translates each event kind into an `UPDATE`.** Rejected: it re-implements the
  fold's rules — deletion is absorbing, last-write-wins on a total order, dedupe by id — in
  SQL. That is the drift this ADR exists to remove.
- **Reshape the port into use-case operations** (`resolve`, `editComment`, …) that both
  adapters implement without an event log. Rejected: it trades a four-method interface for
  roughly ten, which is shallower, and it costs the Sidecar the invariant it was designed
  around — "nothing is ever mutated" as a property of the port rather than of each adapter's
  discipline.
- **Read from the log with no projection.** Rejected: the site-wide `list_comments --since`
  feed would have to fold every Conversation on a Site to answer one query. The Sidecar folds
  on read because it is one person's directory; a hosted Site is not.
- **Keep the adapter in `@scholia/db`,** as ADR-0020 predicted. Rejected: see above — it would
  put a domain dependency on the rate limiter and the GitHub mirror tables.
- **Postgres stamps event time** with `now()`, per ADR-0035. Rejected: `promoteConversation`
  uses one `now` across a header, a summary Comment and a `promoted` event, spanning two
  separate port calls; an adapter stamping per call yields three different values for one
  Promotion. See Consequences for how ADR-0035's concern is met instead.
- **Incremental verb-by-verb cutover** with an additive-only projection write, flipped to
  authoritative at the end. Rejected: a temporary mode whose only benefit is incremental
  shipping, to nobody.
- **Backfilling an event log from existing rows.** Rejected: synthesised events are fiction
  written into a record whose whole point is being a record. Moot in practice — hosted has no
  data — but the reasoning should survive the next migration.

## Consequences

- **The Conversation aggregate is a closed clock domain, and this amends ADR-0035.** Node
  stamps event timestamps, as it does for the Sidecar, and the projection's `created_at` is
  derived from the event rather than from `now()`. No Conversation timestamp is ever compared
  against a Postgres-stamped one, which is the defect ADR-0035 was written to prevent rather
  than the `new Date()` call itself. This _fixes_ ADR-0035's second motivating defect by
  construction: `list_comments --since` compared microsecond `created_at` against the
  millisecond ISO string the API emits, and a Node-stamped source is millisecond-precision to
  begin with. ADR-0035 continues to govern every other timestamp in Postgres unchanged.
- **`promoteConversation` scans every Conversation on the Site.** `promote.ts:105` calls
  `listConversations()` unfiltered to find an orphan Thread. Performance characteristics are
  part of an interface, so this is a real cost, accepted: Promotion is rare and
  human-initiated, this is the belt-and-braces path behind an in-memory check, and a lookup
  method would buy one query at the price of a shallower port.
- **The repository stops writing other aggregates.** `insertMentions` becomes part of the
  projection — core already owns `parseMentions`, so mention targets are derivable from the
  fold. `persistViewerDisplayName` (which updates `viewers`) and the `comment_mirrors` insert
  move out to the inbound adapters that own those concerns.
- **`repos.ts` loses a contiguous ~700-line block** and `@scholia/db` gains no dependency.
  `@scholia/server` is its only consumer, so the split has exactly one caller to update.
- **The projection tables are free to be reshaped.** Pre-1.0 with no hosted data, they should
  be shaped for what hosted reads actually need rather than preserved as they stand.
- **`@scholia/core` needs a `conversation` subpath export** so the adapter can import the
  domain without `app/docs.ts`, whose `renderMarkdown` import is the single edge dragging
  shiki and katex behind the domain. One tsup entry, mirroring the existing `browser` one.

# Conversation state changes are events, and the fold is order-independent

## Status

accepted

## Context & Decision

ADR-0019 chose an append-only YAML stream and named the events: `comment`, `edited`,
`deleted`, `reacted`, `resolved`, `reopened`, `reanchored`. It did not say what the fold
does when two of them disagree — and a Sidecar marked `merge=union` guarantees they will,
because git keeps **both sides' documents, in whatever order the diff produced**, and a
cherry-pick or rebase can deliver the same event twice.

So the fold is specified as a **pure function of the event set**, in `@scholia/core`
(`foldConversation`), not in the adapter. Its result must not depend on the order or the
multiplicity of the events it is given:

1. **Dedupe by event id first**, keeping the first occurrence. A duplicate is a no-op
   rather than a double-post (ADR-0019 already required this for `comment`; it holds for
   every kind).
2. **Sort into a total order before interpreting anything** — timestamp, then event id.
   File position means nothing after a union merge. Ids are UUIDv7, so two events written
   in the same millisecond still sort the same way on every machine.
3. **Resolve conflicts by last-write-wins on that order.** The latest `edited` is the
   body. The latest of `resolved`/`reopened` is the state, and `resolvedBy` names the
   author of a winning `resolved` only — a reopened Conversation has nobody who resolved
   it. The latest of `reacted`/`unreacted` per (Comment, author, emoji) decides whether
   that author is reacting.
4. **A tombstone is absorbing.** `deleted` is the one rule that is not last-write-wins: no
   later event can undo it. An edit that could resurrect a deleted body would mean text
   somebody removed reappearing on a merge, which is the one failure this format exists to
   prevent. A tombstoned Comment keeps its place in the thread, so the reply below it still
   reads as a reply to something; its body and its reactions go.

Three decisions follow from having to make all of that expressible:

- **`unreacted` is added to the vocabulary.** ADR-0019 had `reacted` and no way to take one
  back. The alternative was a `reacted` event carrying `active: false`, which keeps the
  event list literally as written at the cost of an event whose name says the opposite of
  what it means. `resolved`/`reopened` were already a symmetric pair; reactions now match.
- **`deleted` carries a `target`, which may be the Conversation's own id.** That is how a
  whole Conversation is deleted: one more document in its own stream. The file stays, with
  every document it ever had. `listConversations` drops a tombstoned Conversation, because
  "no longer on the Page" is a domain rule — the store's job is to report what the stream
  says.
- **Unrecognised event kinds are skipped, not rejected.** A committed Sidecar can be read
  by an older Scholia than the one that wrote it. `reanchored` is named in ADR-0019 and
  nothing writes it yet; a stream carrying one is still a readable Conversation.

Authorization is at the use case, not the store, because **the stream cannot say no**: an
`edited` event naming someone else's Comment is a well-formed document the fold would
honour. Every command reads the aggregate back and checks before it appends. Who may do
what:

| Verb                  | Who                                                      |
| --------------------- | -------------------------------------------------------- |
| resolve / reopen      | anyone — the event records who, so nothing is anonymous  |
| react / un-react      | anyone, from the fixed palette only (CONTEXT "Reaction") |
| edit a Comment        | its author alone — no moderator override                 |
| delete a Comment      | its author, or the Owner                                 |
| delete a Conversation | the Owner alone                                          |

The Owner may **remove** anyone's words but never **rewrite** them: moderation is deletion,
and an edit is always the author speaking. Locally the Owner is the reader at this machine
— the same loopback, non-tunnelled test that gates "Open in editor" (ADR-0017, ADR-0022), so
a Tunnel guest can comment and react but cannot delete the host's Conversations. Whoever
runs the CLI is always the Owner: the Sidecar is a directory on their own filesystem.

## Considered Options

- **Mutating a `resolved` field on the header.** Rejected outright by ADR-0019: the header
  is immutable, and a mutable field is exactly what union merge corrupts.
- **Last-write-wins for deletion too**, so a later edit un-deletes. Rejected: see above —
  removed text must not come back on merge. Absorbing deletion also has the nicer property
  that the fold need not order deletes against edits at all.
- **Vector clocks / Lamport timestamps** instead of wall-clock + id. Rejected as far more
  machinery than the conflict profile justifies: these are review comments, not a
  collaborative text buffer, and a resolve racing a reopen is rare and cheap to get wrong
  in either direction — what matters is that everyone gets it wrong the _same_ way.
- **A separate reaction file per Conversation**, to keep tallies out of the comment log.
  Rejected: it splits the aggregate, so a Conversation would no longer be one read.

## Consequences

- **The fold moved out of the Sidecar adapter into core.** The adapter parses YAML and
  writes bytes; what an event means is domain logic, and a Postgres-backed stream has to
  agree with it.
- **The repository port widened**: `appendComment` became `appendEvent`, and
  `getConversation` was added, because every command has to read the aggregate before it
  can authorize an append.
- **A Conversation's file only ever grows.** Reactions in particular are chatty — a toggled
  reaction is two documents. That is the price of a format nobody has to merge by hand.
- **The reaction palette is now enforced in `@scholia/core`**, and mirrored (not imported)
  in `@scholia/ui`, which depends on nothing but Preact (ADR-0030). A test in
  `@scholia/local` — which depends on both — asserts the two lists are identical.

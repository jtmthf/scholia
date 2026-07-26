# Local Preview hosts Conversations, persisted beside the content

## Status

accepted (reverses the "no comment chrome" scope in ADR-0010 and `CONTEXT.md`'s
Local Preview entry)

## Context & Decision

`CONTEXT.md` originally said the locally-served reading view "carries no comment chrome
(there is nothing to anchor to yet)": Local Preview was the on-ramp, hosting was the
product. We are reversing that. **Local Preview carries the full comment surface**, and
hosting becomes a later promotion rather than the destination.

The long-term goal is unchanged and larger than either: one product, local *and* hosted,
covering what Proof and Plannotator each do and surpassing both on one consistent
surface. Local-first is the order we build it in, not a retreat from hosting.

Three things drove it:

- **Hosting's remaining work is the expensive kind.** Private Sites, teams and real login
  are all explicitly out of v1 scope, and reaching them means auth, a deploy target,
  abuse handling and uptime before anyone can use the thing. M2–M11 built a *deployable
  server*, not a *running service*.
- **The differentiator is structural, not incremental.** Comments that survive an agent's
  edits — anchored, migrated, marked Outdated — are the thing `@collab/core` already
  does and neither Proof nor Plannotator has. Plannotator's annotations appear to be
  session-transient; Proof says "every character tracks who wrote it" and nothing about
  what happens to a comment when the text moves. Anchoring is the moat, and it works
  locally.
- **It's where the users are.** `scholia@0.1.0` shipped Local Preview and nothing else.

**Conversations persist in the repository, beside the content** (the **Sidecar**), not in
a database and not in a central user directory. Untracked by default via a self-ignoring
directory, so a teammate who has never heard of Scholia sees a clean `git status`;
committing it is an explicit per-repo opt-in.

**A Comment binds to the Page's content hash**, not to a Version. Hosted Versions become
a named set of content hashes layered on top, so the binding is identical on both sides
and promotion is a serialization rather than a translation. Provenance (commit SHA, dirty
flag) rides alongside as context — it cannot *be* the binding, because the dominant local
case is commenting on output an agent has just written and not committed.

## Considered Options

- **A session-scoped review gate** (Plannotator's shape): agent finishes, a hook opens the
  browser, you mark up, feedback returns as a blob, annotations discarded. Rejected: it
  makes comments a *transport* rather than an artifact, and it competes with Plannotator
  on installer polish and agent integrations, where they are ahead. It is also a strict
  subset — once persistence exists, a lifecycle hook that opens Scholia is small — and the
  reverse is not true.
- **An embedded agent** ("highlight a span and chat with a model inside Scholia").
  Rejected for now: it requires a model provider, API keys, token costs and a chat UI, and
  it strands agent-agnosticism. Today any agent can drive Scholia; that is worth keeping.
- **Storing Conversations outside the repo** (`~/.scholia/<project>/`). Rejected: it kills
  the team story entirely and breaks when the directory moves.
- **Writing comments into the markdown source** (HTML comments or a directive). Rejected:
  Scholia and the user's agent would both be mutating the same bytes, and an agent
  rewriting a paragraph mid-comment is a lost-update bug rather than an edge case. It also
  pollutes rendered output and needs a syntax markdown fights, for threads, reactions,
  resolve state and Outdated.

## Consequences

- **Git becomes the team feature.** A committed Sidecar means a teammate clones and sees
  anchored Conversations with no account, no server and no permissions model — the
  permissions are the repository's. This is most of "private sites for teams," delivered
  by git. Because the opt-in is deliberate rather than automatic, it must be documented
  loudly; nobody will stumble into it.
- **Outdated becomes continuous.** Hosted resolves anchors at upload against immutable
  Versions; locally the file is live, so anchors re-resolve on every read and Outdated is
  computed, not stored. Migration quality therefore matters *more* locally than hosted —
  edits arrive continuously rather than in discrete uploads. PLAN.md §8 risk 3 (a fixture
  corpus of v1→v2 diffs, measuring migrate-vs-Outdated accuracy) is now on the critical
  path rather than a nice-to-have.
- **Versions narrow to a hosted-only concept**, and `CONTEXT.md` says so.
- The hosted code is not stranded — it stays gated, and the application layer beneath it
  (ADR-0020) is shared.

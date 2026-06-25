# Mirror comments to native GitHub PR comments for PR-backed Sites

## Status

accepted

## Context & Decision

Teams adopt Collab unevenly: a reviewer may use Collab while teammates live in the PR. To let everyone participate, a Site created from a GitHub PR (a **PR-backed Site**) mirrors its public discussion to and from the PR's **native GitHub comments**.

The key framing: this is **not** a replaceable comment store. Anchoring/rendering need every comment in Collab's own model, private Chats are Collab-only, and inbound GitHub comments must be imported to be shown — so **Postgres stays authoritative for storage** (ADR-0004 stands, not overturned) and GitHub is a **projection**. We model this as a **`MirrorProvider`** port (defined in `core`, implemented per-provider — `@collab/github` for v1, GitLab/Bitbucket/etc. later); `server` routes domain events to any provider whose `appliesTo` matches; `db` remains the single source store. At most one provider per Site, fixed by the **Content source**.

Rules that fall out:

- **Visibility gates the backend.** Private Chat = DB only; Public Thread = DB + GitHub. **Promotion** is the moment curated content first appears on GitHub.
- **Origin owns the comment.** A comment is authoritative on the side it was authored; the other side holds a read-only mirror. No comment is dual-editable → no edit-merge conflicts. (Already consistent with Collab's "edit your own only" rule.)
- **Anchoring uses the source-range bridge.** A Collab Anchor's source range maps to a GitHub PR review comment `{commit, path, line range, side}`; inbound, GitHub `{path, line range}` slices the source we hold → text-quote → resolves via the existing engine. Comments on lines outside the PR diff (which GitHub may reject) degrade **best-effort** to a file-level comment that quotes the text — preserving visibility, losing line precision; Collab's own view stays precisely anchored.
- **PR head advance → new Version** (only when an in-scope Page's bytes change), reusing migration; GitHub's native "outdated" and resolve map onto Collab's **Outdated** and **Resolved**.
- **Identity:** outbound comments are authored by a single Collab **bot** (GitHub App) with the real native Identity in the body; inbound GitHub authors become `source: github` Identities. Per-user OAuth is the long-term direction, deferred until durable accounts exist.
- **Resolve** syncs both ways, last-writer-wins. **Reactions** are import-only (outbound collapse to one bot reaction is misleading).
- **Sync:** webhooks primary + low-frequency reconciliation poll + **poll-only fallback** for firewalled self-hosts. Operator-level opt-in (one GitHub App per instance), distinct from the end-user "no config" promise.
- **Lifecycle:** failures degrade to DB-only (never block local use); externally-deleted bot comments are respected, not resurrected; PR merged/closed offers freeze; **PR locked auto-freezes**.

We rejected a **replaceable `CommentStore`** (DB or GitHub) because anchoring, private Chats, and inbound import all require the DB regardless; **per-user OAuth now** (contradicts anonymous Share-URL access, ADR-0001/0006); and **commit-comments for branch/tag/commit sources** (low visibility, second anchor path, little payoff) — GitHub mirroring is **PR-only**.

## Consequences

- Requires an Owner-authorized GitHub App with PR-scoped access — a narrowing of ADR-0007 (see ADR-0009).
- Reactions and out-of-diff anchors are lossy outbound; this is accepted and visible, not silent.
- GitHub integration is operator + Owner opt-in; it does not weaken the zero-config promise for ordinary (local/non-PR) use.
- New external dependency surface (GitHub API/webhooks, rate limits, eventual consistency) confined to `@collab/github` and the async mirror queue.

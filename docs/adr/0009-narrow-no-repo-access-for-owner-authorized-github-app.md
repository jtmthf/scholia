# Narrow "no repo access" for an Owner-authorized GitHub App

## Status

accepted (narrows ADR-0007)

> **Update (2026-07-26):** "Collab" below refers to what is now named Scholia
> (workspace/env-var rename, issue #15). Left as originally written.

## Context & Decision

ADR-0007 deliberately gave Collab **zero repo access** — no clone, pull, push, or stored credentials; Provenance is metadata only. The GitHub comment mirror (ADR-0008) cannot honor that absolutely: it must **read PR file bytes at the head commit** (to render Pages and slice anchors) and **read/write PR comments**.

We narrow ADR-0007 to the **smallest viable break**: enabling GitHub mode for a Site requires the **Owner to authorize a Collab GitHub App**, scoped to **read PR files + read/write PR comments on the bound repo only**. We deliberately keep everything else off the table: no `git clone`/`pull`, no write to repo contents, no push, no stored personal access tokens, no access to repos that aren't bound to a PR-backed Site.

For all non-PR-backed Sites (local path, branch/tag/commit sources), **ADR-0007 stands unchanged**: Provenance only, no repo access.

## Consequences

- The relaxation is explicit, Owner-initiated, and per-repo — not an ambient capability of the service.
- Self-hosting GitHub integration now requires registering one GitHub App (operator-level); firewalled instances use the poll-only fallback (ADR-0008). This is a real step up from "dirt simple," confined to operators who opt in.
- The host-and-comment boundary is preserved for code: Collab still never writes to or clones the repo; it reads PR doc files and writes PR comments, nothing more.

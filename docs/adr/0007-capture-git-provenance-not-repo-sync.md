# Capture git Provenance at upload; do not sync the repo

## Status

accepted (narrowed by ADR-0009 for PR-backed Sites)

> **Update (2026-07-26):** "Collab" below refers to what is now named Scholia
> (workspace/env-var rename, issue #15). Left as originally written.

## Context & Decision

Agents (especially a reviewer's agent in a private Chat) answer questions "grounded in the actual code," but their local repo may not match the hosted Version they're reading. To let agents align before grounding — and to give humans a trust signal — `upload`, when run inside a git repo, records best-effort **Provenance** on the Version: repo remote URL, commit SHA, branch, and a dirty-working-tree flag. Provenance is surfaced to agents (fetch/checkout the matching commit, detect drift) and shown to humans.

We deliberately **do not** give Collab any access to the repo (no clone, pull, push, or stored credentials). Provenance is metadata captured client-side at upload time only. This keeps the host-and-comment boundary intact (the repo stays canonical and owned by the user), preserves zero-config and the security posture, and avoids the operational weight of bidirectional sync. Repo sync is a possible future-state item alongside the live-editor direction.

## Consequences

- Drift detection is the agent's responsibility using Provenance; Collab offers the facts, not enforcement.
- Dirty-tree uploads are flagged so agents/humans know the snapshot is approximate and not pinned to a clean commit.
- Uploads outside a git repo simply carry no Provenance — a degraded but valid case.

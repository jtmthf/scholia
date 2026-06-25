# Three-tier actor model and localStorage-scoped private Chats

## Status

accepted

## Context & Decision

Reviewers can bring their own agent to a shared Site and hold private, anchored conversations ("highlight a span, ask my agent") that are private by default and promotable to public Threads. This introduces per-viewer-private data and a third kind of actor — neither the Owner nor a passive reader — which ADR-0001's "everything visible by link" and ADR-0005's two-link model did not cover.

We adopt a **three-tier actor model**:

1. **Owner** — holds the API Token / Owner-scoped Agent URL; full write (upload Versions, delete, manage).
2. **Viewer + Viewer's agent** — a Viewer is an anonymous identity minted client-side (id + secret in localStorage). It owns its private Chats and may admit its own agent via a **Viewer-scoped agent token** (read the Site, read/post in that Viewer's Chats, create/post public Threads) — but has no Owner powers.
3. **Anonymous passerby** — read + public comment via the Share URL.

A **Chat** is a Private Conversation scoped to a Viewer's token; promotion flips it to a public Thread. Privacy is enforced solely by the secrecy of the Viewer token.

## Consequences

- Private Chats are **localStorage-grade private**: clearing/losing the token loses the Chats; this is "private from casual view," not secure storage. Accepted for v1.
- The data model gains per-Viewer ownership and a visibility scope on Conversations; the API gains Viewer-scoped tokens alongside Owner tokens.
- This slots under future real auth cleanly: a logged-in user is just a durable Viewer, and the tiers become real roles.

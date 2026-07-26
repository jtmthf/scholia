# Local Preview is the default entry; sharing is an explicit promotion

## Status

accepted

> **Update (2026-07-26):** "Collab"/"collab" below refers to what is now named
> Scholia (workspace/env-var rename, issue #15). Left as originally written.

## Context & Decision

`collab` absorbs a previously separate local markdown dev server (mdttp) as its
**Local Preview** mode. The bare command `collab <path>` renders a local file or
folder in the browser with **no account, token, or network** — it is the default,
zero-friction entry point, and nothing leaves the machine. Uploading is a separate,
explicit verb: `collab share <path>` mints the Site and returns the Share URL.

We chose local-first over upload-first (the original PLAN had `collab <file>` upload
immediately) because the funnel — _preview locally, then choose to share_ — is the
whole reason the local tool and the hosted service belong together. It also makes the
first thing a new user experiences the renderer working perfectly with zero setup,
and keeps the most sensitive action (publishing content to a public URL) opt-in. The
"one command → instant shareable link" demo still exists; it is just `collab share`.

## Consequences

- Bare `collab <path>` no longer touches the network; the instant-link pitch moves to
  `collab share`.
- Local Preview produces no Version and no Share URL, and its reading view carries no
  comment chrome (there is nothing to anchor to yet).
- CLI entry semantics are a contract; changing the default verb later breaks muscle
  memory and any scripts, which is why this is recorded.

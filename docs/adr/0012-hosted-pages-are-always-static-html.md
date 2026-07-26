# Hosted Pages are always static HTML; evaluation/builds happen only on trusted surfaces

## Status

accepted

> **Update (2026-07-26):** "collab" below refers to what is now named Scholia
> (workspace/env-var rename, issue #15). Left as originally written.

## Context & Decision

mdttp _evaluates_ MDX — it runs the file as Preact code — which is fine for Local
Preview (trusted, the author's machine) but unacceptable for hosted collab, which treats
all hosted content as **untrusted, agent-generated** bytes. The domain model has only two
Page kinds (Markdown Page, HTML Page); there is no "MDX Page."

We make MDX a **Local-Preview-only** feature. On `collab share`, MDX is evaluated locally
on the trusted authoring machine and uploaded as a pre-rendered **HTML Page**; hosted
collab never executes MDX. PR-backed Sites (no local machine in the loop) do not support
`.mdx` in v1 — markdown/html only.

The general invariant: **whatever the authoring/build pipeline produces, a hosted Page's
rendered form is always static HTML, flattened on the trusted side at share time.** Two
independent reasons require this:

1. **Trust** — compiled MDX/React/Preact is untrusted JS and cannot run on collab's
   trusted app origin.
2. **Anchoring** — text-quote comments need a stable DOM/text to bind to; a live
   client-rendered SPA has a dynamic DOM that makes anchors unreliable. Static HTML gives
   stable anchors.

## Consequences

- A shared `.mdx` becomes a DOM-anchored HTML Page, so comments anchor to its rendered
  output, not its `.mdx` source — accepted for v1.
- The untrusted-code-execution surface on collab's infra is exactly zero.
- A future `collab build` (mdttp's planned build command) is two things sharing one
  compile front-end: an _export_ path that emits a deployable Preact app for hosting
  **elsewhere**, and the _share_ path that always flattens to static HTML for collab
  hosting. They diverge only at the output.

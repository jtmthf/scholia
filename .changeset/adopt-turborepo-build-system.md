---
"scholia": patch
---

Adopt Turborepo for the workspace build/typecheck/test graph, with every package publishing a built `dist` (ADR-0037). No change to the published CLI's behavior — `packages/cli`'s own `tsup` bundle is unchanged, just now built with its workspace dependencies resolved from their own `dist` instead of source.

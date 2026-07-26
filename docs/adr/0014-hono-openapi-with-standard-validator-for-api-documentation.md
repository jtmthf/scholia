# `hono-openapi` + `@hono/standard-validator` for API documentation

> **Update (2026-07-26):** "Collab" below refers to what is now named Scholia
> (workspace/env-var rename, issue #15). Left as originally written.

Route definitions serve double duty: they handle requests and generate an OpenAPI 3.1 spec. We use `hono-openapi` (the newer Hono OpenAPI middleware) with `@hono/standard-validator` rather than a separate contract-first spec or the older `@hono/zod-openapi`.

**Why:** A contract-first approach (write an OpenAPI spec, generate types and validation from it) duplicates the artifact count — every route is defined in two files that must stay in sync. `@hono/zod-openapi` is battle-tested but wraps the Hono request/response lifecycle with its own middleware. `hono-openapi` + `@hono/standard-validator` is idiomatic to Hono's evolving standard validator pattern: route handlers stay close to vanilla Hono, and OpenAPI metadata is registered alongside them without a framework wrapper.

**Trade-off:** `hono-openapi` is newer and has less community battle-testing than `@hono/zod-openapi`. But it avoids the middleware-wrapping indirection and aligns with Hono's direction. Since Collab has no users yet and we can change freely, the risk of churn is acceptable.

**Decision:** Use `hono-openapi` + `@hono/standard-validator`. Annotate Wave 1 routes (prompt, state, content, conversations) first to prove the pattern, then retrofit remaining routes. The OpenAPI spec is served from a discoverable endpoint (e.g. `GET /openapi.json`) so agents and tools can consume it without reading source.

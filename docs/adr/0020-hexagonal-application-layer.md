# Hexagonal architecture: an application layer with ports and adapters

## Status

accepted

> **Update (2026-07-26):** `@collab/*` below refers to what is now `@scholia/*`
> (workspace/env-var rename, issue #15). Left as originally written.

## Context & Decision

`@collab/db` exports ~60 free functions (`repos.ts`, ~64KB) that each take a live Drizzle
handle as their first argument, and route handlers call them directly. There is no port,
no interface and no adapter; `DbOrTx` even leaks Drizzle's transaction type into
signatures. That is fine for one storage engine and one transport, and it blocks
everything in ADR-0018 — Local Preview cannot serve Conversations from the Sidecar when
persistence is welded to Postgres, and the CLI, REST API and MCP server cannot share one
verb set when the verbs live in HTTP route handlers.

We adopt **hexagonal architecture**, with proper DDD as the direction of travel:

- **An application layer owns commands and queries** — the use cases. This is also the
  single verb set that every surface renders.
- **Inbound adapters**: the CLI, the REST API, and MCP (stdio and streamable HTTP).
- **Outbound ports**, owned by `@scholia/core`: `ConversationRepository` alongside the
  existing `MirrorProvider`. `core` is already defined as pure domain logic with no HTTP
  and no db, and already owns a port that infrastructure implements — this is that pattern
  applied to persistence.
- **Outbound adapters**: Postgres in `@scholia/db`, the Sidecar in its own package, plus
  the existing blob store and GitHub provider.

**Conversation is the aggregate root.** Comments, Reactions and resolve state live inside
its boundary and are never addressed independently by the repository. This codifies
existing behaviour rather than imposing new structure — `getCommentConversation` exists
precisely because a Comment is only reachable through its Conversation.

**The port is extracted narrowly**, covering only the Conversation surface. Tokens,
Viewers, Versions, mirrors and rate limiting stay Postgres-only, on routes Local Preview
never mounts.

**The extraction happens while writing the Sidecar adapter**, not before it. A port
designed against one implementation is shaped like that implementation; two adapters
pulling on it at once is what makes the interface discovered rather than invented.

**The application is a client/server protocol, not necessarily HTTP.** When the target is
local, the CLI and MCP invoke the application **in-process**; when it is remote, an HTTP
adapter implements the same interface. The abstraction is the use case, not the wire.

## Considered Options

- **A full port over all ~60 operations.** Rejected: the local surface is genuinely a
  subset, and a full port would force the Sidecar to answer forty questions it will never
  be asked — worse, the interface would be shaped by Postgres's needs, including
  transactions, which a directory of files cannot honestly implement.
- **No port; reimplement the comment routes in the local server.** Rejected: guaranteed
  drift between two implementations of the same product.
- **A verb registry in the REST client**, with CLI and MCP rendering from it. Rejected once
  hexagonal was adopted: it puts the verb set in an *adapter* and makes the CLI a client of
  another inbound adapter — adapter calling adapter, with a needless hop.
- **Generating the verb set from the OpenAPI spec** (ADR-0014). Rejected: the REST API and
  the agent verb set are not the same shape. `list_comments --unresolved --since
  --mentions` spans several REST concerns, and agent verbs need prose descriptions written
  for an LLM, which is tool-design copy rather than API documentation.
- **Always going over HTTP, even locally**, with the local server as sole writer.
  Rejected: it requires a daemon, a discovery file and auto-spawn, and it means an agent
  can only comment while a human happens to have a preview open — backwards, since agents
  often work while nobody is watching.

## Consequences

- **Transactions stay inside the Postgres adapter.** Every port operation must be coarse
  enough to be atomic by contract, which the existing use-case-shaped functions
  (`createSiteWithVersion`, `promoteConversation`) already are.
- **Two adapters persist one aggregate in two styles** — an append-only event log locally,
  state-stored rows in Postgres. The repository hides that, which is its job, but it is
  real work rather than a formality: an operation cheap in one style may be awkward in the
  other.
- **In-process invocation means two writers** when a preview server is also running.
  Append-only plus UUIDv7 means concurrent writes interleave rather than corrupt, and the
  fold dedupes — but appends must still be atomic at the OS level (`O_APPEND` with a lock
  file, or write-temp-then-rename), which is a real implementation requirement.
- **That same property is a feature**: watching the Sidecar makes an agent's comments
  appear live in the browser over the existing live-reload channel. Under an
  always-HTTP design this would have required building a daemon.
- **"Same API" is true for the Conversation surface and false elsewhere.** A local server
  has no `POST /sites`, no token rotation, no `/internal/drain`. Clients must handle a
  base URL that supports a subset, by capability detection or by failing clearly.
- `routes/conversations.ts` (~39KB) and `repos.ts` (~64KB) both need surgery. This is the
  single largest item in the roadmap and it is invisible from any feature list.

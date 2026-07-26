# Neither CLI nor MCP is the primary agent surface

## Status

accepted

## Context & Decision

There is an unsettled industry debate about whether agents are better served by MCP or by
a CLI plus optional skills. We are not picking a side, because the answer depends on the
agent: one with shell access is often better served by a CLI it can compose and pipe; one
without — a hosted agent, a browser-based assistant — can only reach MCP.

**Scholia exposes the same verbs through three inbound adapters, and none of them is
primary**: CLI subcommands, MCP over stdio, and MCP over streamable HTTP. Capability
parity is a requirement, not an aspiration.

Parity is enforced structurally: all three render **the application layer's command and
query set** (ADR-0020). Adding a verb in one place lights it up on every surface, so drift
is not something a test catches after the fact — it is unrepresentable.

The MCP server ships as a **subcommand of the CLI** (`scholia mcp`) rather than a separate
package. The CLI is already the install, and a separate package means a second publish, a
second version, and skew between an MCP and the application it drives. The HTTP transport
covers clients that cannot spawn a process.

**Agent documentation is served, not shipped.** `/agent-docs` describes the capabilities
of *that* instance, so a local server documents no tokens and no Versions while a hosted
one documents tiers — and neither can drift from the code. A static copy ships in the
package for bootstrap.

## Considered Options

- **MCP only.** Rejected: it is strictly worse for agents that already have a shell, and
  it makes Scholia unusable from scripts, git hooks and CI.
- **CLI only.** Rejected: hosted agents without bash access could not use Scholia at all.
- **Hand-maintaining both with a parity test.** Rejected: the test reports drift after it
  has shipped.

## Consequences

- **A generic renderer produces uniformly mediocre commands.** Positional arguments,
  short flags and sensible defaults are what make a CLI pleasant, so each verb carries a
  CLI hint (positional order, aliases). The registry constrains *capability* parity without
  flattening the interface.
- Adding a verb means writing its LLM-facing description once, deliberately — that copy is
  part of the application layer, not an afterthought in a route handler.
- Three surfaces over one verb set means a bug in a use case is a bug everywhere, which
  cuts both ways.

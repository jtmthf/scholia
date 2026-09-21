# A local Agent Connection is a cursor loop with expiring Agent Presence

## Status

accepted

## Context & Decision

Local Preview already lets a human start a private Chat and lets an agent read and reply
through the CLI or MCP, but nothing joins those halves into an interaction a user can see.
**Add Agent** copies an Agent Prompt that tells the agent to connect, read unresolved Chats,
and monitor the served root. Connection is one cursor-based application operation: the
agent identifies itself, supplies the last activity cursor it processed, and waits up to a
bounded timeout for a Conversation event. The first call establishes Agent Presence;
repeated calls renew it, and stopping lets it expire.

The operation is rendered through the same CLI and MCP registry as the other agent verbs,
with Local Preview exposing an HTTP adapter too. Its result is a wake signal, never an
alternate Conversation projection: after activity the agent rereads Chats from the
authoritative Sidecar before acting. Agent Presence is transient, local-only, and stored
outside the committed Sidecar streams so visible connection state cannot create a
synthetic Conversation or travel through git.

## Considered Options

- **An embedded agent.** Rejected for 0.2 for the reasons in ADR-0018: it introduces a
  model provider, credentials, cost, and process lifecycle into a tool whose agents
  already run beside it.
- **A copied prompt followed by blind polling.** Rejected as the product contract: it
  hides whether the handoff worked and makes every agent invent polling intervals and
  race handling. The cursor loop gives all adapters one bounded wait and one ordering
  rule.
- **A synthetic “Connected” Chat.** Rejected because connection state is not discussion
  about a Page and would pollute the Conversations the feature exists to carry.

## Consequences

- Agent Presence is deliberately narrower than future human presence or collaborative
  editing: an agent name, status, and last-seen time scoped to one Local Preview.
- The connection operation is a deep seam shared by CLI, MCP, HTTP, the Agent Prompt, and
  the end-to-end test. Adding client-specific launch or configuration logic is not part of
  this decision.
- If an agent disappears without disconnecting, its Presence ages out; stale connection
  state is never interpreted as an active agent.

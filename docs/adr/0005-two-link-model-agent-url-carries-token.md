# Two link types: read-only Share URL vs token-bearing Agent URL

## Status

accepted

## Context & Decision

Collab issues two distinct links per Site:

- **Share URL** — public, given to human reviewers. Grants anonymous read + comment only (per ADR-0001). Never confers write/owner capability.
- **Agent URL** — given to an agent for zero-install onboarding. Embeds an API Token capability directly in the URL (`?token=…`, Proof-style). Holding it equals holding the API Token: full write capability.

The installed CLI/MCP path instead reads the Token from a local credentials file (`~/.collab/credentials`); the Agent URL exists for the no-install case and for "copy agent prompt" UX.

We deliberately accept bearer-token-in-URL — normally an anti-pattern — because it makes agent onboarding frictionless, which is core to the product. We mitigate the known leak vectors: tokens are revocable/rotatable, Agent URLs can be scoped and expiring, content pages send `Referrer-Policy: no-referrer`, and the Agent URL is never shown to or shared with human reviewers (who get the Share URL instead).

## Consequences

- Token may leak via server logs, browser history, or copy-paste; rotation/expiry and the read-only/write link split contain the blast radius.
- Two links to keep conceptually separate in UI, docs, and the copy-prompt feature; conflating them would hand reviewers write access.
- A future real-auth model can demote the Agent URL to one of several credential paths without breaking the Share URL contract.

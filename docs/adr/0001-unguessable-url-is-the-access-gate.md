# Unguessable URL is the access gate (v1)

## Status

accepted

## Context & Decision

Collab promises a zero-config, no-login experience. For v1 we accept that the only access control on a Document is its **unguessable URL**: the Document ID is a long random slug, and anyone holding the link can both read and comment. There is no read/comment split and no per-user auth. Crawling is mitigated with `X-Robots-Tag: noindex` and no directory listing.

We chose this over (a) a separate capability/token to comment, and (b) private-by-default with an explicit publish step, because both add config/friction that contradicts the core promise. This mirrors "anyone with the link" sharing in Google Docs, Excalidraw, and paste tools.

## Consequences

- A leaked link is fully public — acceptable for a trusted-team, share-by-link tool; not acceptable for sensitive documents (a known v1 limitation).
- Future auth (private/public Documents, roles, teams, login) layers on top by making the slug-gate one of several access modes rather than the only one — so this is reversible additively, but URLs already shared/embedded under v1 semantics constrain how strict we can retroactively become.

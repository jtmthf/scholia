# `?include=` expand pattern on `GET /sites/:slug` for agent orientation

`GET /sites/:slug` (currently site metadata + page list) gains a `?include=` query param to inline sub-resources — sources, comments, chats — so an agent can orient on a Site in one call instead of N+2.

**Why:** Agents need page sources, comments, and Chats on first visit. Without expansion those require separate calls (metadata, then per-page content, then comments), adding latency and complexity. Dedicated endpoints (e.g. `GET /sites/:slug/comments`) remain for surgical queries; `?include=` is the bundled-fast-path.

**Trade-off:** RESTful purity says sub-resources live on their own endpoints with independent caching and auth gating. Bundling them into the site state response couples concerns. But agent orientation is the critical path, not a rare operation — paying the round-trip tax on every agent session is worse than the coupling cost. The dedicated endpoints still exist; `?include=` is additive.

**Decision:** Accept `?include=sources,comments,chats` (comma-separated) on `GET /sites/:slug`. The response without `?include=` is unchanged. With `?include=sources`, each page carries a `source` field (inlined raw content); without it, pages carry a `sourceUrl` reference. `?include=comments` requires no auth; `?include=chats` is gated to the Viewer token in the request (a public caller omits it or gets an empty array).

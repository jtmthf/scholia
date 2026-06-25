# All Page content runs in a sandboxed, cross-origin iframe

## Status

accepted

## Context & Decision

Collab hosts arbitrary, agent-generated content and overlays a commenting UI on it. **Both Page kinds** render inside the same sandboxed `<iframe>` served from a **separate origin** (e.g. `*.usercontent.collab.app`): HTML Pages directly, and Markdown Pages after server-side conversion to HTML. The Collab chrome — comment rail, text selection, anchor markers — lives in the parent document on the main origin. Markdown's Source Map is produced at render time on the server and used by the bridge to turn an iframe selection into a markdown source range; this is just the Markdown flavor of the same anchor-resolution bridge HTML Pages use.

We unify both kinds under one iframe because rendered markdown is also untrusted/arbitrary (raw HTML passthrough, mermaid/diagram scripts, math), so a single isolation model and a single anchoring bridge beats maintaining a separate "trusted inline" path with its own sanitizer treadmill. The two communicate over a small injected `postMessage` bridge that ferries selection ranges and anchor coordinates across the frame boundary.

We deliberately **preserve the uploaded page's JavaScript** rather than stripping it, because interactivity (collapsible sections, diagrams/mermaid, tabs, charts) is part of why someone hosts HTML rather than markdown. The cross-origin sandbox contains the security blast radius: untrusted page JS cannot reach the Collab REST API, read the main origin's storage, spoof comments, or phish under the main domain.

We rejected sanitize-and-inline (DOMPurify-style, no iframe) because it kills interactivity and turns XSS defense into a perpetual sanitizer-bypass treadmill.

## Consequences

- Anchoring must work across the frame boundary: a tiny bridge script is injected into the iframe to resolve text-quote anchors and report selections to the parent.
- Two origins to operate (content origin + app origin) and a `postMessage` protocol to version.
- A malicious uploaded page is contained but can still present misleading content within its own frame; the surrounding Collab chrome makes the trust boundary visible.

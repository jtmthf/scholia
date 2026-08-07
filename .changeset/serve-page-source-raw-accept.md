---
"scholia": minor
---

Serve a Page's Source via `?raw` and `Accept: text/markdown` on both Local Preview and the hosted content origin. `?raw` returns Source verbatim with the correct Content-Type per Page kind. `Accept: text/markdown` returns the Source for Markdown Pages or best-effort derived text for HTML Pages (marked `X-Scholia-Source: derived`). Documented in the Agent Docs (`/agent-docs`).

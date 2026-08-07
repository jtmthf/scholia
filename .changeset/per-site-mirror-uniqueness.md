---
"scholia": patch
---

Fix inbound comment import silently dropping all but one PR-backed Site (issue #40). The `comment_mirrors` unique index is now scoped per-site so the same external comment can be imported independently for each matching PR-backed Site.

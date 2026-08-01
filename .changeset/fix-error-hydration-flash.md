---
"scholia": patch
---

Fix loading flash on 404/500 viewer pages: errored queries are now dehydrated with the cache so the client renders the failure view immediately instead of briefly showing "Loading…" and refetching.

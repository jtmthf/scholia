---
"scholia": patch
---

Fix hosted viewer client-side JS crashing in the browser. `@scholia/core`'s barrel file eagerly loaded server-only modules (FsBlobStore → node:path) whenever the web package imported it for `guardRegexInput`, halting all JS execution and preventing Preact from hydrating. Added a `browser` export condition pointing to a browser-safe entry, and replaced `export *` with explicit named exports.

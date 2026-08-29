---
"@scholia/local": patch
---

Fix a Local Preview shutdown race where a file-change refresh already in flight (or a debounced watch callback not yet fired) could still run after `close()` returned, sometimes logging a `refresh failed` error against state the caller had already torn down. `close()` now cancels any pending debounced callback and waits for the last triggered refresh to settle before returning.

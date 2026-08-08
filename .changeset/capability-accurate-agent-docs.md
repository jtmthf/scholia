---
"scholia": minor
---

Serve capability-accurate Agent Docs per instance. The docs are generated from the application layer's verb registry, so an instance documents the verbs it actually answers: a Local Preview serves them at `/__agent-docs` and describes the Sidecar in the tree with no account to hold, while a hosted server serves `/agent-docs` and describes its tiers, token scopes and Versions. Both carry the prompt-injection trust framing, and both answer HTML for a browser or Markdown for an agent (`?raw` / `Accept: text/markdown`). The root `scholia.SKILL.md` is replaced by a generated static copy at `skills/scholia/SKILL.md`, which now ships in the package and says how to fetch the live copy.

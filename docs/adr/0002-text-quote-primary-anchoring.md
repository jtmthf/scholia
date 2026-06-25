# Text-quote anchoring is primary; structural hints are secondary

## Status

accepted

## Context & Decision

Comments anchor to specific spans of a Page, and those anchors must survive re-uploads (new Versions) and be resolvable by agents editing local source. We store an Anchor's **primary** representation as a **text-quote** — the exact highlighted string plus prefix/suffix context (W3C-style) — and treat structural locators as **secondary** hints: a source line/column range (available for *both* markdown and HTML, since Collab hosts canonical source for both) plus XPath/CSS selectors for HTML Pages.

We store all selectors together (text-quote + source range + XPath/CSS, W3C-multi-selector style). The structural selector is used as a cheap **fast path for same-Version display** (`querySelector`/`document.evaluate`), but the **text-quote is authoritative**: it is the source of truth on conflict, the key for best-effort cross-Version migration, and the payload agents receive from `list_comments`. Structural selectors are deliberately *not* the migration key because they break on the exact operation Collab centers on — re-upload/re-render — where a positional selector can silently resolve to the wrong element; the text-quote instead stays put or honestly goes Outdated.

We chose this over making DOM paths / line numbers the source of truth because structural locators are brittle: they break under re-rendering, regeneration, minification, and any content edit, and a stale line number silently points at the wrong place. A text-quote degrades gracefully (it either matches or is explicitly marked Outdated) and is directly actionable by an agent grepping its own source.

## Uniqueness by construction

An Anchor must ground to something **unique**. At creation, the prefix/suffix context is expanded until the text-quote uniquely identifies its target within the document; the precise source range pins it exactly (inherently unique for that Version). We do not use occurrence ordinals or "Nth match" tiebreaks. At cross-Version migration the unique quote must re-resolve to exactly one match — zero or multiple matches mark the Conversation **Outdated** rather than risk anchoring to the wrong occurrence. Anchoring wrong is worse than an honest "this moved."

## Consequences

- Cross-Version anchor migration and Outdated detection reuse one matching algorithm (unique text-quote search), rather than diffing DOM trees or line tables.
- Source ranges are only valid against the exact Version's source; if an agent's local copy has drifted, line/col is stale — text-quote is the safety net.
- Context expansion happens at creation so every Anchor is unique within its Version; ambiguity can only re-emerge across Versions, where it resolves to Outdated.

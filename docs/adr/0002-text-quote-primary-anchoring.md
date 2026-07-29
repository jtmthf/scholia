# Text-quote anchoring is primary; structural hints are secondary

## Status

accepted

> **Update (2026-07-26):** "Collab" below refers to what is now named Scholia
> (workspace/env-var rename, issue #15). Left as originally written.

> **Update (2026-07-29):** Measured against real agent edits (issue #24,
> [findings](../research/anchor-migration-accuracy.md)). The decision below is
> unchanged and its central claim held: across 106 migrations an Anchor never
> once re-anchored to the wrong text. What the measurement did change is what
> counts as a required match — see "Context secures uniqueness; it is not itself
> a match requirement" at the end.

## Context & Decision

Comments anchor to specific spans of a Page, and those anchors must survive re-uploads (new Versions) and be resolvable by agents editing local source. We store an Anchor's **primary** representation as a **text-quote** — the exact highlighted string plus prefix/suffix context (W3C-style) — and treat structural locators as **secondary** hints: a source line/column range (available for _both_ markdown and HTML, since Collab hosts canonical source for both) plus XPath/CSS selectors for HTML Pages.

We store all selectors together (text-quote + source range + XPath/CSS, W3C-multi-selector style). The structural selector is used as a cheap **fast path for same-Version display** (`querySelector`/`document.evaluate`), but the **text-quote is authoritative**: it is the source of truth on conflict, the key for best-effort cross-Version migration, and the payload agents receive from `list_comments`. Structural selectors are deliberately _not_ the migration key because they break on the exact operation Collab centers on — re-upload/re-render — where a positional selector can silently resolve to the wrong element; the text-quote instead stays put or honestly goes Outdated.

We chose this over making DOM paths / line numbers the source of truth because structural locators are brittle: they break under re-rendering, regeneration, minification, and any content edit, and a stale line number silently points at the wrong place. A text-quote degrades gracefully (it either matches or is explicitly marked Outdated) and is directly actionable by an agent grepping its own source.

## Uniqueness by construction

An Anchor must ground to something **unique**. At creation, the prefix/suffix context is expanded until the text-quote uniquely identifies its target within the document; the precise source range pins it exactly (inherently unique for that Version). We do not use occurrence ordinals or "Nth match" tiebreaks. At cross-Version migration the unique quote must re-resolve to exactly one match — zero or multiple matches mark the Conversation **Outdated** rather than risk anchoring to the wrong occurrence. Anchoring wrong is worse than an honest "this moved."

## Consequences

- Cross-Version anchor migration and Outdated detection reuse one matching algorithm (unique text-quote search), rather than diffing DOM trees or line tables.
- Source ranges are only valid against the exact Version's source; if an agent's local copy has drifted, line/col is stale — text-quote is the safety net.
- Context expansion happens at creation so every Anchor is unique within its Version; ambiguity can only re-emerge across Versions, where it resolves to Outdated.

## Context secures uniqueness; it is not itself a match requirement

_Added 2026-07-29, from the issue #24 measurements._

Read the rule above carefully: prefix/suffix context is described as the **mechanism for achieving uniqueness**, never as something that must itself match at migration time. The implementation made it one anyway — capture attached 32 characters of context to every Anchor including ones already unique by `exact` alone (explicitly as "resilience"), and `searchQuote` then required that context literally. Belt-and-braces resilience became the only thing that ever broke.

The cost was measurable and one-sided. Wrongly Outdated fired on 29% of single edits and 50% of Anchors carried across a document's full history, and **every single instance had its quoted text still present and still unique in the new Version.** Meanwhile the failure this ADR exists to prevent — an Anchor silently re-attaching to the wrong text — never occurred.

So migration **falls back to matching `exact` alone when context fails, still gated on `exact` resolving uniquely in the new Version.** The uniqueness gate is untouched, and it is the whole safety property: a document carrying decoy copies of the quoted text fails that gate and the Anchor stays Outdated. This relaxes what is _required_ to match, not how closely it must match.

Three things this deliberately does **not** do:

- **No fuzzy matching and no similarity threshold.** The 29% rate looks like a case for approximate matching, but the entire measured failure was context-only — no approximate matching is needed to fix it, and a threshold would manufacture the one failure class that currently has zero instances. Matching stays literal. An Anchor is never presented as certain when it was not matched literally, and breaking that should be a deliberate decision rather than a drift.
- **No incremental re-anchoring.** Re-capturing the quote on each successful migration is a provable no-op under literal matching — across 56 successful migrations, re-capture produced a differing quote 0 times, and it cannot do otherwise, since a successful match means the stored context is already a literal substring at the matched position. It only becomes a meaningful choice under tolerant matching, which is precisely where it turns into the mechanism by which an Anchor walks away from what the comment meant, one approved step at a time.
- **No reader-facing signal when the fallback fires.** Whether it fires depends on how much text changed within the capture window, an implementation constant — and it fires on roughly a third of edits, so a per-Anchor badge would be noise correlated with nothing a reader cares about. The fallback count is reported in the migration report as operator telemetry instead. A reader asking "what changed around this" is served by the Diff and by the Comment's content-hash binding.

The corpus is prose from a single repo, and its zero-decoy result would not survive contact with generated reference documents. The uniqueness gate is what makes that acceptable: more decoys mean fewer fallback rescues, not more wrong landings.

One known gap is deliberately left open rather than decided here: capture can still exhaust its context budget and return a quote that is _still_ ambiguous, with no signal to the caller. Such an Anchor is Outdated on arrival. It never occurred in this corpus (0 of 9,729 positions) and it is a capture-time concern rather than a migration-time one, so it is tracked separately.

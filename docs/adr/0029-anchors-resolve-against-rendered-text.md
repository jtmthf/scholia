# Anchors resolve against rendered text, on both the hosted and local paths

## Status

accepted

Refines [ADR-0002](./0002-text-quote-primary-anchoring.md) and constrains the local
re-resolution work in [ADR-0018](./0018-local-preview-hosts-conversations.md) /
[ADR-0019](./0019-conversation-storage-append-only-yaml-log.md).

## Context & Decision

A Markdown Page exists in two text layers: the markdown Source the author (or agent) edits, and the rendered text a reader sees. An Anchor has to be re-resolved against one of them. Hosted migration already picks rendered — it matches against `renderedText(html)` at each upload boundary. Local Preview has no Conversation storage yet, so the choice there is still open, and issue #24 expected the local path to differ because edits arrive continuously against live files rather than in snapshots.

**Anchors resolve against rendered text on both paths.** The local path re-resolves against the Page as rendered from the current file contents, not against the markdown bytes.

The measurement that prompted the question found the two layers differ by _layer_, not by edit frequency: an `oxfmt` run rewrites `*x*` to `_x_`, changing Source bytes while leaving rendered text byte-identical. Source-layer resolution would therefore mark Conversations Outdated on a formatter run that a reader never sees. But two structural reasons decide it, and they would hold even without that finding.

**Capture and resolution must share a layer.** A quote is captured from a browser selection over rendered DOM text. Searching for that string in markdown Source means looking for it in a representation it was never drawn from — `**bold**` markers, link syntax and table pipes are present in one and absent from the other. Any passage containing inline formatting would simply fail to match. This is a category error, not a tolerance problem, and no amount of normalisation makes the two layers the same string.

**Divergence would fire at the promotion boundary.** `scholia share` publishes the same content as the first Version of a Site. If Local Preview resolved in Source and hosted resolved in rendered, a Conversation live locally could go Outdated the instant it was shared — at exactly the moment a user is most likely to read it as data loss. One layer means one behaviour across the promotion.

## Consequences

- One matching algorithm and one text layer serve both paths, so migration behaviour is testable once and cannot silently drift apart.
- Local re-resolution must render the Page before matching. Rendering is already on the local read path, so this is a shared cost rather than a new one, but it does mean re-resolution cannot be done against raw file bytes as a shortcut.
- The Anchor's source range stays a secondary hint on both paths, recomputed from the Source Map against current contents and stale whenever those contents have moved on. `CONTEXT.md`'s **Markdown Page** entry previously described that secondary range as the anchoring mechanism; it has been corrected.
- A formatter run does not outdate Conversations. An edit that changes rendered text does, which is the honest answer — that is what a reader would see.

---
"scholia": minor
---

Comments follow the text as your agent edits it, and the ones that can't follow tell you
what they were written about.

Local Preview now re-resolves every Anchor against the file as it currently stands, on every
read — through the same matcher the hosted path uses at an upload boundary, so a Conversation
can't change its mind about being Outdated the moment you share it. A passage that moved or
was rewritten around is found again; a passage that is genuinely gone becomes Outdated, kept
in its own section of the rail with the original quote it was written about. Nothing is ever
rewritten in the Sidecar, which is what lets an Outdated comment go on showing what the
passage used to say — and what lets it re-attach by itself if the text comes back.

Anchors resolve against the Page's rendered text, not its markdown source, so a formatter run
that rewrites `*emphasis*` to `_emphasis_` changes nothing a reader can see and outdates
nothing.

Outdated is now decided before the page is sent, so a Conversation reads as Outdated in the
first response — including with JavaScript turned off.

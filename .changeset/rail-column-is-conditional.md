---
"scholia": patch
---

Local Preview: an un-commented Page no longer pays a column for its empty Rail.
The Rail element is still always mounted — it is the page's only hydration
boundary and the element live reload writes an agent's first Comment into — but
its grid track is now keyed on a new `body.has-conversations` in place of
`body.has-comments` (ADR-0039). With nothing said about a Page the Rail stacks
under the article, where its empty state and its no-JavaScript Composer still
say that commenting exists, and the words get the width back.

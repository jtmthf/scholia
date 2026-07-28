---
"scholia": patch
---

Fix Local Preview's main content column collapsing into the Outline's narrow track whenever Nav is shown — the mobile nav's backdrop `<div>` had no default `display: none`, so it became an implicit CSS Grid item at desktop widths and stole the content column, squeezing the article into ~220px. Also give Nav a subtitle when sibling Pages share an identical title (e.g. several root docs each opening with `# Scholia`), so they're no longer indistinguishable in the sidebar.

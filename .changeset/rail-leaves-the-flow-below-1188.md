---
"scholia": minor
---

Below 1188px, Local Preview's comment Rail leaves the flow and becomes an overlay (ADR-0039,
issue #160) instead of stacking under the article — the pattern already used for narrow-viewport
Nav (a fixed surface with a backdrop, dismissed by Esc or a backdrop click, its own scroll,
focus trapped while open and returned to the opener on dismiss). Clicking an annotated passage
is the primary opener, the same click that already focuses the passage's Conversation card at
any width; a topbar control (`💬`, next to the theme toggle) is the discoverable fallback, and
reflects open/closed state via `aria-expanded`. With no JavaScript the Rail stays in the flow
instead — never a column below this width, but never hidden either, so every Conversation is
still reachable.

`#scholia-comments` remains the single element the comment layer hydrates (ADR-0031); the
overlay's open/close chrome is wired by delegation in `main.ts`, the same as the Nav drawer,
reacting to a plain DOM event (`scholia:rail-open`) dispatched from the click handler that
already knows whether a click hit a highlighted passage.

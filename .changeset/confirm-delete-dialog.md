---
"scholia": patch
---

Fix deleting a Conversation running with no confirmation at all, and give it and deleting a Comment matching in-app confirmation dialogs (replacing native `window.confirm`) instead of two visually-identical "Delete" buttons — now "Delete Comment" and "Delete Conversation", and the Conversation dialog names what's lost ("Delete this Conversation and its 3 Comments?").

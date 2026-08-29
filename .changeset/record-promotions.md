---
"scholia": patch
---

Record Chat promotions and refuse duplicate promotions. Promoting a Chat now appends a `promoted` event naming the Thread and selected messages, writes the Chat origin onto the Thread header, and rejects an exact repeat with the existing Thread id. The rail surfaces both ends: Chat cards show their promoted Threads and Thread cards show the Chat they came from.

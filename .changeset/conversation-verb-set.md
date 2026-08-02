---
"scholia": minor
---

Resolve, reopen, react, edit and delete Conversations — in Local Preview and from the CLI.

Every one is an event appended to the Sidecar: nothing rewrites or removes a document, and
a delete leaves a tombstone rather than a hole. Concurrent conflicting events (a resolve on
one side of a merge, a reopen on the other) fold to the same answer for everyone.

New commands, all naming a Conversation with `--conversation` and, where they act on one
Comment, a `--comment` (`scholia comments --json` prints both ids):

- `scholia resolve` / `scholia reopen`
- `scholia react --emoji 👍` (`--remove` to take it back; the palette is 👍 👎 ✅ 👀 🎉 ❤️)
- `scholia edit-comment --body <text>`
- `scholia delete-comment`
- `scholia delete-conversation`

`scholia comments` now shows resolve state, edited markers, tombstones and reaction
tallies, and its `--json` output carries them as `resolved`, `resolved_by`, `edited_at`,
`deleted` and `reactions`.

---
"scholia": minor
---

`scholia mcp` — the same verbs an agent gets on the CLI, over MCP.

Both surfaces now render one command and query set, so a verb exists on both or on neither.
`scholia mcp` serves it over stdio, or over streamable HTTP with `--http [port]` for clients
that cannot spawn a process. Nothing needs to be running: the verbs invoke the application
in-process against the Sidecar in the tree you are standing in, so an agent can leave a
Comment from CI or a git hook, in a repository where Scholia has never been started. If a
preview happens to be open, that Comment shows up in the reader's browser live.

Every verb also takes `--server <url>` (or `SCHOLIA_SERVER`) to run against a hosted Site
instead, through the same interface.

- `scholia comments [page]` and `scholia chats [page]` take `--unresolved`, `--since <iso>`
  and `--mentions <name>`, and list every Page when no page is given. `scholia chats` is now
  local-first rather than hosted-only.
- Conversation commands take positional arguments as well as their flags:
  `scholia reply <conversation> <body>`, `scholia react <conversation> <comment> 👍`,
  `scholia resolve <conversation>`, `scholia comment <body> --page <path>`. The flag form
  still works everywhere.
- `--json` prints exactly what the MCP tool returns for the same call.

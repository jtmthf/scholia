# scholia

## 0.2.0

### Minor Changes

- [#99](https://github.com/jtmthf/scholia/pull/99) [`e1f1d51`](https://github.com/jtmthf/scholia/commit/e1f1d51c14e4ce45bb51e560a67c390821a06e64) Thanks [@jtmthf](https://github.com/jtmthf)! - `scholia mcp` — the same verbs an agent gets on the CLI, over MCP.

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

- [#79](https://github.com/jtmthf/scholia/pull/79) [`09cd9ad`](https://github.com/jtmthf/scholia/commit/09cd9ad62817f57586ba82dd9d7f0112238c6963) Thanks [@jtmthf](https://github.com/jtmthf)! - Add `scholia comment` and `scholia comments` — create and list anchored Conversations from the CLI, persisted beside content in `.scholia/conversations/`.

- [#94](https://github.com/jtmthf/scholia/pull/94) [`3aa74bc`](https://github.com/jtmthf/scholia/commit/3aa74bc7c34523457a035f46b2a1b8d8d959776d) Thanks [@jtmthf](https://github.com/jtmthf)! - Add `scholia commit-sidecar` — opt a repository in to committing its Conversations, so they travel with the content and git becomes the review channel. Writes the merge attributes that let concurrent replies merge instead of conflict, stages the store, and reverses with `--undo`. Chats are never included. The Sidecar stays untracked by default.

- [#89](https://github.com/jtmthf/scholia/pull/89) [`00a0e0e`](https://github.com/jtmthf/scholia/commit/00a0e0e0392e75be47d58d0c9c394f408591ea1c) Thanks [@jtmthf](https://github.com/jtmthf)! - Resolve, reopen, react, edit and delete Conversations — in Local Preview and from the CLI.

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

- [#91](https://github.com/jtmthf/scholia/pull/91) [`d2021c3`](https://github.com/jtmthf/scholia/commit/d2021c39eefbe69c7a62c3b487b95e699224fcd3) Thanks [@jtmthf](https://github.com/jtmthf)! - Your agent editing the file while you're mid-comment no longer costs you your selection or
  your draft.

  Local Preview watches the tree, so a file being rewritten under you is the normal case, not
  an edge one. While a selection is live or a Composer is open, the live-reload swap is held:
  the Page you're reading stays exactly where it is, and a quiet "this file changed" notice
  offers you the update whenever you want it. Stop composing and the update lands by itself.

  Posting a Comment now always succeeds. A file that changed while you were writing never
  rejects one — the Anchor is a text-quote, so the passage is found wherever it moved, and if
  it's gone the Conversation is kept and shown as Outdated with its original quote intact,
  which tells you what you were commenting on. Conversations whose passage no longer appears
  on the Page are gathered into the rail's Outdated section instead of sitting silently among
  the anchored ones.

  Drafts are kept per passage for the life of the tab, so taking an update — or a refresh —
  brings back what you were writing.

- [#82](https://github.com/jtmthf/scholia/pull/82) [`103479b`](https://github.com/jtmthf/scholia/commit/103479b7818a20d78368caf3e48e376c9671e352) Thanks [@jtmthf](https://github.com/jtmthf)! - Comment on what you're reading. Select text in Local Preview and a Conversation starts, anchored to the passage you highlighted and saved beside your content in `.scholia/conversations/` — still there, still anchored, when you reload. Page-level comments and replies work too, and `.html` files are now Pages: they render in the chrome, appear in the Nav, and take comments the same way markdown does. Each Comment records the content hash of the Page as you read it, plus the commit SHA and dirty flag where the directory is a git repository.

- [#93](https://github.com/jtmthf/scholia/pull/93) [`1b4582b`](https://github.com/jtmthf/scholia/commit/1b4582b1d4b00476a913e131314e61111f2b6b99) Thanks [@jtmthf](https://github.com/jtmthf)! - Add `--chat` flag for private Chats, `--agent` flag for agent identity, and `scholia promote` to turn Chat messages into a public Thread.

- [#92](https://github.com/jtmthf/scholia/pull/92) [`f341496`](https://github.com/jtmthf/scholia/commit/f3414963a8d94d4c8760ca5675f9802cd4322390) Thanks [@jtmthf](https://github.com/jtmthf)! - Comments follow the text as your agent edits it, and the ones that can't follow tell you
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

- [#85](https://github.com/jtmthf/scholia/pull/85) [`5f4a833`](https://github.com/jtmthf/scholia/commit/5f4a833019ffd8814288d33cb6168269670f11d8) Thanks [@jtmthf](https://github.com/jtmthf)! - Serve a Page's Source via `?raw` and `Accept: text/markdown` on both Local Preview and the hosted content origin. `?raw` returns Source verbatim with the correct Content-Type per Page kind. `Accept: text/markdown` returns the Source for Markdown Pages or best-effort derived text for HTML Pages (marked `X-Scholia-Source: derived`). Documented in `scholia.SKILL.md` and `/agent-docs`.

### Patch Changes

- [#125](https://github.com/jtmthf/scholia/pull/125) [`989f09e`](https://github.com/jtmthf/scholia/commit/989f09ec2ccea4eda58207022029a580dd0556fd) Thanks [@jtmthf](https://github.com/jtmthf)! - Fix hosted viewer client-side JS crashing in the browser. `@scholia/core`'s barrel file eagerly loaded server-only modules (FsBlobStore → node:path) whenever the web package imported it for `guardRegexInput`, halting all JS execution and preventing Preact from hydrating. Added a `browser` export condition pointing to a browser-safe entry, and replaced `export *` with explicit named exports.

- [#96](https://github.com/jtmthf/scholia/pull/96) [`9c91210`](https://github.com/jtmthf/scholia/commit/9c912105c848499730646182a5fed1dd4794d01b) Thanks [@jtmthf](https://github.com/jtmthf)! - Fix the Composer reappearing empty after a posted draft is reloaded.

- [#84](https://github.com/jtmthf/scholia/pull/84) [`9fcad56`](https://github.com/jtmthf/scholia/commit/9fcad56d031a33fe1ffafbf32046168487ff3394) Thanks [@jtmthf](https://github.com/jtmthf)! - Fix loading flash on 404/500 viewer pages: errored queries are now dehydrated with the cache so the client renders the failure view immediately instead of briefly showing "Loading…" and refetching.

- [#125](https://github.com/jtmthf/scholia/pull/125) [`989f09e`](https://github.com/jtmthf/scholia/commit/989f09ec2ccea4eda58207022029a580dd0556fd) Thanks [@jtmthf](https://github.com/jtmthf)! - Fix inbound comment import silently dropping all but one PR-backed Site (issue #40). The `comment_mirrors` unique index is now scoped per-site so the same external comment can be imported independently for each matching PR-backed Site.

- [#86](https://github.com/jtmthf/scholia/pull/86) [`2f16e46`](https://github.com/jtmthf/scholia/commit/2f16e46942b373b99a21cff568da832d92fbaf32) Thanks [@jtmthf](https://github.com/jtmthf)! - Rename Thread → ConversationCard in @scholia/ui to match domain vocabulary, and simplify Reactions component.

- [#98](https://github.com/jtmthf/scholia/pull/98) [`3b2efb5`](https://github.com/jtmthf/scholia/commit/3b2efb58500041df99f213cf4ddff0fc1820d241) Thanks [@jtmthf](https://github.com/jtmthf)! - Add safe-regex input-length guards to prevent polynomial ReDoS on uncontrolled data (ADR-0033).

- [#97](https://github.com/jtmthf/scholia/pull/97) [`b06f170`](https://github.com/jtmthf/scholia/commit/b06f170af0e52727cd6b7d22fa7c7d26240cabab) Thanks [@jtmthf](https://github.com/jtmthf)! - Update drizzle-kit to 0.31.10, removing the gel → shell-quote transitive dependency (Dependabot #11, CVE-2026-13311).

## 0.1.2

### Patch Changes

- [#51](https://github.com/jtmthf/scholia/pull/51) [`f66c538`](https://github.com/jtmthf/scholia/commit/f66c538965fc1a1e387bf1bda4b72aa9829abac1) Thanks [@jtmthf](https://github.com/jtmthf)! - Fix Local Preview's main content column collapsing into the Outline's narrow track whenever Nav is shown — the mobile nav's backdrop `<div>` had no default `display: none`, so it became an implicit CSS Grid item at desktop widths and stole the content column, squeezing the article into ~220px. Also give Nav a subtitle when sibling Pages share an identical title (e.g. several root docs each opening with `# Scholia`), so they're no longer indistinguishable in the sidebar.

- [#47](https://github.com/jtmthf/scholia/pull/47) [`9bbe631`](https://github.com/jtmthf/scholia/commit/9bbe6312caddff30cfd2e7c53585336805df293c) Thanks [@jtmthf](https://github.com/jtmthf)! - Configure automated releases. Adds Changesets (versioning, changelog, CI
  changeset gate) and an npm trusted-publishing release workflow (OIDC, no
  long-lived token). No CLI behaviour change.

# Scholia

A zero-config tool for reading markdown and HTML documents and letting humans and AI agents collaborate on them through anchored comment threads. It runs **local-first** — pointed at a folder on disk, with Conversations persisted beside the content in the same repository — and hosts the same documents and Conversations remotely when they need to outlive the machine. Positioned as a familiar, Notion-like rich-comment collaboration surface pointed at agent-generated md/html whose source of truth lives in a git repo: the repo stays canonical, Scholia carries the feedback loop around it.

## Language

**Site**:
The unit of upload and sharing: a collection of one or more Pages hosted under a single shareable URL. A single uploaded file is the degenerate one-Page Site. A folder/zip becomes a multi-Page Site with a navigable tree and relative links between Pages rewritten to work. Versioning, ownership, and the access gate all live at the Site level.
_Avoid_: project, doc set, bundle
_Future_: Owner-bound custom domains for a Site (Share URL and/or content origin) are anticipated but out of scope for v1.

**Page**:
A single markdown or HTML artifact within a Site, hosted at a path under the Site's URL. Every Page is of a definite kind — a **Markdown Page** or an **HTML Page** — which differ in how they render and how comments anchor. Each Page is independently commentable. A Page's identity across Versions is its **path**: same path = same Page (migrate comments), a renamed/moved/deleted path = a new/removed Page whose old comments become Outdated.
_Avoid_: document, file

**Asset**:
A non-Page file in a Site (image, CSS, JS, font, or any non-`.md`/`.html` file). Served from the content origin so Pages can reference it, but not rendered as a Page, not listed in nav, and not independently commentable.
_Avoid_: resource, attachment

**Entry Page**:
The Page a directory path resolves to — at the Site root (the Share URL itself) or at any folder within it. Chosen by precedence with no config: `index.html` → `index.md` → `README.md` → otherwise the first Page directly inside that directory by filename (Owner-overridable later). The root is the degenerate case where the directory is the Site itself, so one precedence rule serves both.
_Avoid_: home, root page, landing, directory index

**Nav**:
The auto-generated navigation tree for a multi-Page Site, derived from Page paths (folder structure → collapsible tree), each Page labeled by its first `<h1>`/title falling back to filename. Siblings are ordered Entry Page first, then any explicit order, then by **filename** — never by label, so numbered conventions like `0001-…` stay in sequence even though the reader sees the prose title. Relative links between Pages are rewritten to navigate within the Site and keep the comment chrome. No manual nav config.
_Avoid_: sidebar, menu, toc

**Outline**:
The list of a single Page's own headings, shown alongside it and tracking scroll position as the reader moves through the Page. Distinct from Nav: Nav moves between Pages, the Outline moves within one. Derived from the Page's headings with no config.
_Avoid_: toc, table of contents, on this page, minimap

**Colophon**:
The block at the foot of a Page recording where it came from: its path, when it last changed, and its Provenance. Named for the publication note at the end of a manuscript, and placed there for the same reason — it is a provenance record, not part of the reading path, so it sits after the text rather than above it.
_Avoid_: footer, metadata, page info

**Markdown Page**:
A Page whose canonical source is markdown. It is rendered to an HTML page for reading, but comments anchor to ranges in the original markdown *source* (via a Source Map), not to the rendered DOM.

**HTML Page**:
A Page whose canonical source is HTML. It is served as a rendered page and comments anchor directly to the DOM.

**Source Map**:
The mapping between a selection in a rendered Markdown Page and the corresponding character/line range in the original markdown source, produced at render time on the server. Lets a reviewer highlight rendered text and have the comment resolve to a source location. Both Page kinds render inside the sandboxed content iframe (see ADR-0003); the Source Map is the Markdown flavor of the shared anchor-resolution bridge.

**Anchor**:
The attachment point that binds a Thread to a specific piece of a Page. An Anchor must ground to something **unique**: at creation the `prefix`/`suffix` context is expanded until the text-quote uniquely identifies its target (no occurrence ordinals). Its **primary** form is that unique text-quote (`exact` + `prefix`/`suffix` context) that can be searched for in source or DOM. It also carries **secondary** structural hints: a **source range** (line/column in the canonical source — available for both Page kinds, since Scholia hosts the source for both), plus XPath and/or CSS selector for an HTML Page. A source range is only valid against the exact Version's source (stale if the agent's local copy has drifted), which is why resolution is text-quote-first; structural hints are a fallback/bonus. Anchor resolution covers in-page display, cross-Version migration, and what agents receive from `list_comments`. When a new Version is uploaded, Anchors are migrated forward best-effort via text-quote matching; an Anchor whose quote no longer matches becomes Outdated.

**Outdated** (Comment/Anchor):
A Comment whose Anchor no longer matches the text it was written against. It is not deleted; it is shown collapsed / in a side rail, and it retains the original quote, so an Outdated Comment can show what the passage *used* to say. Hosted, this is settled at upload against the Latest Version. Locally it is recomputed on every read, because the files are live and change continuously. Mirrors how GitHub marks PR review comments "outdated" when new commits land.
_Avoid_: orphaned, stale, broken

**Conversation**:
The single entity for all discussion: attached to an Anchor or to a whole Page (Page-level has no Anchor), an ordered flat (non-nested) list of Comments, a Resolved flag, and a **visibility** that is either Private (a Chat) or Public (a Thread). Anchoring, Outdated migration, Reactions, and resolve behave identically regardless of visibility. A new highlight over overlapping text starts a separate Conversation. A Conversation is the unit of consistency: it is stored, moved, and merged whole.
_Avoid_: discussion

**Chat**:
A **Private** Conversation, visible only to its owning viewer and that viewer's agent(s). The default for "highlight a span and ask my agent" — the viewer's agent grounds its answer in the actual code (via the Anchor's text-quote/source range) without Scholia needing repo access.
_Avoid_: DM, private comment, assistant session

**Thread**:
A **Public** Conversation, visible to everyone with the Share URL. The default for review comments.

**Promotion**:
Flipping a Chat to a Thread (private → public). The promoting human selects which messages become public (a summary or chosen messages), rather than dumping the raw Chat transcript.
_Avoid_: publish, share (verb), expose

**Comment**:
A single message within a Conversation, left by a human or agent. A Comment is bound to the **content hash** of the Page as it stood when the Comment was made — one binding local and hosted alike, since a hosted Version is a named set of content hashes. Provenance rides alongside it as context, not as the binding. Uploading a new Version and commenting are independent operations — an upload never carries comment data. Authors may edit/delete their own Comments (edits show an "edited" marker; deletes leave a tombstone); the Owner may delete anyone's.

**Mention**:
An `@`-reference to an existing Identity on the Site (e.g. `@owner-agent`, `@Jane`) used to route/address feedback. Mentioning an agent surfaces in that agent's `list_comments --mentions` filter (and later triggers push). Absence of a Mention = ambient feedback the human tells the agent to sweep.
_Avoid_: tag, ping

**Reaction**:
An emoji from a fixed review-oriented palette (👍 👎 ✅ 👀 🎉 ❤️) placed on a Comment by an Identity. Available to both humans and agents. No free emoji picker in v1 (extensible later).

**Resolved** (Conversation):
A flag marking a Conversation as addressed. For a public Thread, anyone may resolve or reopen (trusted-team tool) and the resolver's identity is shown; resolved Conversations collapse but are never deleted.
_Avoid_: closed, done

**Provenance**:
Best-effort git facts about the directory the content came from: repo remote URL, commit SHA, branch, and a dirty-working-tree flag. In Local Preview they are read live from the working directory, so they track edits as they happen; on upload they are frozen onto the Version, since a Version is immutable and its Provenance must not drift. Surfaced to agents (so a reviewer's agent can fetch/checkout the matching commit and detect drift before grounding answers in code) and shown to humans in the Colophon as a trust signal ("generated from `main` @ `a1b2c3d`, uncommitted changes"). Scholia never accesses the repo itself — Provenance is metadata only (see ADR-0007).
_Avoid_: source ref, git info

**Version**:
An immutable snapshot of an entire hosted Site created by an upload — a named, ordered set of content hashes. A Site is an ordered series of Versions; re-uploading creates a new Version rather than overwriting. Versions are a **hosted-only** concept: Local Preview has none, because the files on disk are live rather than snapshotted. Every upload is full-Site (no partial/single-Page update); the wire transfer is content-hash-negotiated so only missing blobs are sent. A Version's bytes come from a **Content source** (local path / git ref / PR). For a **PR-backed Site**, advancing the PR head commit (when it touches an in-scope Page) produces a new Version automatically, alongside manual re-upload.

**Latest**:
The most recent Version of a Site. The shareable Site URL always resolves to Latest; individual Versions are also addressable by their own permalinks.
_Avoid_: head, current, tip

**Last Seen Version**:
The Version a given viewer most recently looked at, tracked client-side. Used as the default baseline for the "what changed" diff and for the "new since" summary counts surfaced to humans and agents.
_Avoid_: last read, checkpoint

**Diff**:
A per-Page, source-level comparison between two states of a Page. Hosted, the two states are Versions (default: Last Seen Version vs Latest), available in the viewer and via the API alongside `list_versions`. Locally there are no Versions, so the baseline is git — the working tree against `HEAD`. Diffs are not overlaid on the rendered page.
_Avoid_: change view, delta

**Owner**:
The identity that first uploaded a Site and holds its API Token. The only identity permitted destructive/management actions: delete Site/Version, delete any Comment/Conversation, **rotate** the Share URL (kills a leaked link) and the API Token/Agent URLs, and set Site **state** (read-only or frozen). Agents act as the Owner (or a labeled identity under the Owner's token).

**Retention & limits**:
The operator-facing policy on lifespan and size. Default is **infinite retention** for Sites and all Versions, on self-host *and* hosted, constrained only if it becomes a problem. Operator-configurable knobs exist but are unset by default: inactivity TTL, keep-last-N Versions, per-file / per-Site / file-count caps, per-token quotas. End users never configure these and only encounter limits via clear rejection errors — "no config" is a promise to users, not operators.
_Avoid_: TTL, expiry, quota (alone)

**Site state**:
An Owner-set posture on a Site: **open** (default — read + public comment), **read-only** (viewing open, public commenting disabled), or **frozen** (public Threads locked, e.g. once review is done). Per-Viewer/IP rate limiting on comment creation applies regardless of state. Per-Viewer bans and approval queues are deferred to the real-auth era.
_Avoid_: status, mode, locked

**API Token**:
The credential generated on first upload that authenticates write actions (upload Versions, owner/destructive actions, identity-attributed Comments) for a Site. For the installed path it is stored transparently in a local credentials file (`~/.scholia/credentials`) and read silently. Agent-authored Comments are attributed to a named identity tied to the Token. Losing the Token means losing Owner control of the Site in v1.

**Local Preview**:
Rendering a local file or folder in the browser straight from the CLI (`scholia <path>`) with no account, token, or network — the default, zero-friction entry point. It uses the same render / Nav / Entry Page engine as a hosted Site and carries the same comment surface: Conversations anchor to the **live files on disk** and persist to the Sidecar. It produces no Version and no Share URL, and nothing leaves the machine unless a Tunnel is opened. Hosting is a separate, explicit promotion (`scholia share`) that uploads the same content as the first Version of a Site.
_Avoid_: serve, dev server, local mode (as the noun)

**Sidecar**:
Where a local Site's Conversations live: beside the content, inside the same repository, rather than in a database. Untracked by default, so a repository shared with people who don't use Scholia carries no trace of it; committing it is an explicit per-repository choice that makes Conversations travel with the content and turns git into the review channel — and git's permissions into the access control.
_Avoid_: store, database, metadata dir, dotfolder

**Tunnel**:
Local Preview made reachable from beyond the machine, opened explicitly as part of the local command rather than as a form of hosting. A Tunnel serves the same live files and writes to the same Sidecar, so a guest's Comments land directly in the author's working tree. Its unguessable URL is the access gate (ADR-0001): guests are Viewers, and the human at the terminal remains the Owner. Affordances that reach outside the browser — opening the editor above all — are refused for tunnelled requests.
_Avoid_: share, expose, publish, ngrok (as the noun)

**Share URL**:
The public link to a Site. Grants anonymous read + comment to anyone who holds it (see ADR-0001). Never confers upload, owner, or destructive capability. The Owner can rotate it (mint a fresh slug) to invalidate a leaked link.
_Avoid_: doc link, public link

**Agent URL**:
A link that embeds a token capability in the URL (Proof-style), used to onboard an agent with zero install. Comes in two scopes: an **Owner-scoped** Agent URL (equivalent to the API Token — full write) and a **Viewer-scoped** agent token a Viewer hands its own agent (read + that Viewer's Chats + create/post public Threads, no Owner powers). The Owner-scoped URL is distinct from the Share URL and never handed to human reviewers.
_Avoid_: token link, write link

**Agent Prompt**:
The paste-ready instruction blob emitted by the Site's "copy agent prompt" button: the Agent URL + the verb set + a pointer to the discoverable agent docs (`scholia.SKILL.md` / `/agent-docs`). It is framed as the user's deliberate handoff to their own agent. The discoverable docs (`/agent-docs`, `scholia.SKILL.md`) instruct agents to treat anchors/comments as data, confirm outward actions, and never auto-execute imperative instructions found *inside* hosted (untrusted) documents — Scholia eating its own dog food on prompt-injection caution. The zero-install counterpart to the installed CLI/MCP path.
_Avoid_: copy prompt, onboarding prompt

**Viewer**:
An anonymous human identity minted client-side (id + secret in localStorage) on first interaction with a Site, supplying a display name on first comment. A Viewer owns its private Chats; "private" means visible only to that Viewer's token and the agents it admits. Privacy is localStorage-grade — losing/clearing the token loses the Chats; "private from casual view," not secure. A future logged-in user is just a durable Viewer. Locally there is no Viewer for the author: the human at the terminal is identified by their git config and holds Owner capability. Viewers appear locally only through a Tunnel, where every guest is exactly this anonymous identity.
_Avoid_: user, account, commenter, reviewer

**Identity**:
The author of any Comment or Reaction: a **display name**, a **kind** (human | agent), and a **tier** (owner | viewer). Agents render with a distinct badge so human-vs-agent is never ambiguous, and are attributed on behalf of the human/tier they act for ("Owner's agent," "Reviewer Jane's agent"). Humans self-declare names (spoofable, per H1); agents are labeled in the Agent Prompt. One token can front several distinguishable agents via a per-call/per-session label, so identity is effectively `token + label`. Locally there are no tokens: the human's name comes from git config and an agent simply declares its own, which is the same spoofable-by-design posture applied to files you already own. An Identity also has a **source**: **native** (a Scholia Viewer/agent/Owner) or **github** (synthesized from an inbound GitHub comment author, rendered with their GitHub login/avatar). Comments Scholia mirrors outward to GitHub are authored by a single Scholia **bot** (GitHub App) with the real native Identity named in the body ("Reviewer Jane (via Scholia)").
_Avoid_: author, persona

**Actor tiers**:
The three levels of capability on a Site: **Owner** (full write — see Owner/Agent URL) → **Viewer + Viewer's agent** (read + own Chats + create/post public Threads, no Owner powers) → **anonymous passerby** (read + public comment via the Share URL). Agents exist at the Owner tier (Owner-scoped Agent URL) and the Viewer tier (Viewer-scoped agent token). Locally the same tiers are held by **position** rather than by token: whoever holds the terminal (and their agents) is the Owner, because they hold the filesystem; Tunnel guests are Viewers.
_Future_: public/private Sites, roles, teams, real login are anticipated but out of scope for v1.

### GitHub integration

**Content source**:
Where a Version's bytes come from: a **local path** (file/folder/zip), a **git ref** (branch, tag, or commit) fetched via the GitHub API, or a **PR** (the changed md/html files at the PR's head commit). Orthogonal to the comment backend — only the PR source enables GitHub comment persistence. A pinned ref or PR yields clean Provenance; a local working tree may be dirty.
_Avoid_: input type, upload mode

**PR-backed Site**:
A Site whose Content source is a GitHub PR. Its Pages are the PR's changed md/html files rendered at the PR head commit (Pages outside the PR are excluded); its **Public Threads** mirror to and from the PR's native GitHub comments while **Private Chats** stay Scholia-only. The comment backend is chosen by **visibility, not configuration**: private = DB, public = DB + GitHub. Each comment is owned by its **origin** (the side it was authored on) and is read-only on the other side.
_Avoid_: GitHub site, linked site, synced site

**Mirror**:
The act and result of projecting a Public Thread's Comments onto native GitHub PR comments (outbound) and importing GitHub PR comments as Threads (inbound). A `github_comment_id ↔ comment_id` mapping dedupes the loop. GitHub's native "outdated" review comments and resolve state map onto Scholia's **Outdated** and **Resolved**.
_Avoid_: sync (alone), replicate, copy

_Future direction_: Scholia may grow from a read-and-comment tool (the source of truth stays in the repo; Scholia carries the feedback loop and edits are incorporated by the author or their agent) into a live WYSIWYG collaborative editor with presence and in-place edits (Proof-style). The architecture should not preclude this, but Scholia is read-and-comment only for now. Presence ("who's viewing now") is deferred to this future work.

A second future direction is a `scholia build` command (inherited from mdttp's roadmap): an *export* path that compiles a Site to a deployable Preact app for hosting elsewhere. It shares a compile front-end with `scholia share` but diverges at the output — the share/hosting path always flattens to static HTML, because hosted Pages must stay non-executing and stably anchorable (ADR-0012). Build/export is now on the roadmap rather than hypothetical: it is how Scholia's own documentation ships (ADR-0023), and it is a publishing path only — a static export has no backend, so Conversations do not work on it.

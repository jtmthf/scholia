# Collab — v1 Implementation Plan

This plan turns the design in `CONTEXT.md` and `docs/adr/0001–0012` into a build.
It is sequenced as **tracer-bullet vertical slices**: every milestone is end-to-end
and shippable on its own.

## 1. Stack

Chosen to honor the ADRs (content-addressed blobs + Postgres; one core, thin
CLI/MCP/REST clients; sandboxed cross-origin iframe; local-first entry; unified
Hono+Preact stack) and to keep one language across the agent surface, render pipeline,
and viewer. The former standalone local markdown dev server (**mdttp**) is folded in as
collab's **Local Preview** mode (ADR-0010); its render / Nav / search / Entry Page code
becomes `@collab/core`.

- **Language / runtime:** TypeScript on Node 22.
- **Monorepo:** pnpm workspaces.
- **Server:** **Hono** (ADR-0011) — the Local Preview server, the hosted REST API, and
  the content origin. Web-standard `Request`/`Response` keep the local and hosted servers
  one idiom; built-in SSE covers live-reload now and push later; deploys to Node and
  Cloudflare Workers (matching the R2 content-origin/edge grain).
- **DB:** Postgres, accessed via Drizzle (type-safe schema + migrations).
- **Object storage:** S3-compatible via the AWS SDK v3 behind a thin `BlobStore`
  interface; **content-addressed by sha256**. Local dev = MinIO (docker-compose);
  prod = R2/S3.
- **Markdown render + source map:** `unified`/`remark` → `rehype` (shared in `@collab/core`).
  mdast/hast nodes carry `position` (line/col + offset), which becomes the **Source Map**.
  Plugins: `remark-gfm`, `remark-math` + `rehype-katex`, footnotes, `remark-directive` for
  callouts; `shiki` for syntax highlighting; mermaid rendered client-side inside the
  iframe.
- **MDX:** evaluated **only on trusted surfaces** — in Local Preview and at `collab share`
  on the author's machine — then flattened to static HTML for hosting (ADR-0012). Hosted
  collab never executes MDX.
- **HTML ingest + source locations:** `parse5` with `sourceCodeLocationInfo` to map a
  DOM node back to a source line/col range.
- **Anchoring:** the matching engine is `diff-match-patch` (Google; stable). Text-quote
  matching + our uniqueness-by-construction context expansion live in `core` and run
  against **source strings**. In the iframe, DOM Range ↔ string-offset mapping uses the
  Hypothesis lineage (`dom-anchor-text-quote` / `dom-anchor-text-position`, or Robert
  Knight's newer `anchor-quote`); the match itself defers to `core`'s rules.
  Note: **do not** use `@apache-annotator/*` — the Apache Annotator podling was retired
  and the repo archived (Aug 2025).
- **MCP server:** `@modelcontextprotocol/sdk`.
- **View:** **Preact** (ADR-0011), SSR'd via `preact-render-to-string` on a Hono route.
  Local Preview ships the SSR'd chrome with little-to-no hydration. The hosted **Viewer**
  is an interactive data-cache SPA — Preact + Vite + **TanStack Query** + a small router —
  that SSRs the shell and public Threads, then hydrates the comment layer (rail, selection,
  anchor markers). The Collab chrome is the parent document; Page content renders in a
  sandboxed cross-origin iframe. `hono/jsx` is reserved for purely-static routes (e.g.
  `/agent-docs`).
- **Auth:** opaque capability tokens (random, stored hashed); see §4.

### Package layout

```
packages/
  core/      @collab/core   — domain logic: ingest, render, source map, anchoring,
                              migration, manifests, content addressing, Nav, Entry Page,
                              search (Orama), frontmatter/headings — the render/nav/search
                              engine shared by Local Preview and hosting; plus the
                              `MirrorProvider` port. No HTTP/db.
  local/     @collab/local  — Local Preview server (Hono): file-watch, live-reload,
                              in-memory search, SSR'd Preact reading view. Trusted local
                              content, no auth, no network. (ex-mdttp.)
  db/        @collab/db      — Drizzle schema + migrations + repositories.
  server/    @collab/server  — Hono REST API + content-origin server. Wraps core+db;
                              loads configured MirrorProviders and routes domain events.
  github/    @collab/github  — GitHub `MirrorProvider`: App auth, PR file/comment API,
                              webhook parsing, content-source fetch at a ref/PR head.
  cli/       @collab/cli     — `collab` command. `collab <path>` runs Local Preview via
                              `@collab/local`; `collab share` uploads via REST.
  mcp/       @collab/mcp     — MCP server. Thin client over REST.
  web/       @collab/web     — Preact viewer (Vite + TanStack Query) + iframe bridge.
  bridge/    @collab/bridge  — tiny script injected into the content iframe
                              (selection capture, anchor resolve, postMessage).
```

`core` is pure and unit-testable; `server` is the only place HTTP + db meet; CLI and
MCP never talk to the db directly (ADR: one core, thin clients).

## 2. Origins & isolation (ADR-0003, ADR-0001)

- **App origin** (`collab.app`): viewer chrome + REST API.
- **Content origin** (`*.usercontent.collab.app`, per-Site subdomain or path): serves
  Page HTML and Assets into the sandboxed `<iframe sandbox="allow-scripts ...">`.
- Content responses send `X-Robots-Tag: noindex` and `Referrer-Policy: no-referrer`.
- Parent ↔ iframe communicate only via a versioned `postMessage` protocol (`bridge`).
- Untrusted page JS runs in the iframe and cannot reach the app origin, the REST API,
  or app-origin storage.

## 3. Data model (Postgres sketch)

Immutable content lives in blobs; everything below is mutable metadata (ADR-0004).

- `sites` — id, slug (Share URL), state (`open|read_only|frozen`), created_at,
  mirror_binding (jsonb, nullable: provider, repo, pr_number — set for a PR-backed Site).
- `site_tokens` — id, site_id, kind (`owner|viewer`), label, token_hash, revoked_at.
- `versions` — id, site_id, ordinal, created_at, content_source (jsonb: kind
  `local|ref|pr`, ref/pr details), provenance (jsonb: remote, sha, branch, dirty),
  is_latest.
- `manifest_entries` — version_id, path, kind (`markdown|html|asset`), content_hash,
  title, rendered_hash (for pages), source_map_hash (markdown/html).
- `viewers` — id, site_id, display_name (nullable), created_at. (Identity = viewer or
  token+label; agents attributed on behalf of a tier.)
- `conversations` — id, site_id, created_version_id, page_path (nullable for
  page-level), visibility (`private|public`), owner_viewer_id (for private),
  resolved_at, resolved_by, anchor (jsonb: text-quote {exact,prefix,suffix},
  source_range, xpath, css), anchor_status (`live|outdated`).
- `comments` — id, conversation_id, version_id, author (jsonb: name, kind, tier,
  on_behalf_of, source `native|github`), origin (`collab|github`), body, edited_at,
  deleted_at (tombstone), created_at.
- `comment_mirrors` — comment_id, provider, external_id, external_url,
  status (`pending|synced|failed|detached`), last_synced_at. (dedup map + outbound
  state; `external_id` ↔ `comment_id` prevents echo loops.)
- `reactions` — comment_id, author, emoji. (Imported GitHub reactions carry
  `author.source = github`; reactions are not mirrored outbound.)
- `mentions` — comment_id, target_identity.
- `viewer_state` — viewer_id, site_id, last_seen_version_id.

Blobs (content-addressed): raw source files, rendered HTML, serialized Source Maps.

## 4. Capability tokens (ADR-0005, ADR-0006)

- First `collab share` mints a Site + an **owner token**; CLI/MCP persist it to
  `~/.collab/credentials` keyed by Site.
- **Owner-scoped Agent URL** embeds the owner token. **Viewer-scoped agent token**
  embeds a viewer-tier capability (read + that viewer's Chats + create public Threads).
- **Share URL** = the Site slug, no token; read + public comment only.
- Tokens are random opaque strings, stored hashed; rotation = new token, revoke old.
- Three-tier authorization middleware in `server` resolves a request to
  owner / viewer+agent / anonymous and gates each verb.

## 5. Milestones (vertical slices)

### M0 — Skeleton & infra
pnpm monorepo (folding mdttp in), docker-compose (Postgres + MinIO), Drizzle migrations
bootstrap, `BlobStore` interface + content-addressed put/get (local FS + MinIO), Hono
boot, health check, CI (typecheck + test). Carve `@collab/core` out of mdttp's
render/Nav/search code.

### M1 — Local Preview (local-first spine; mdttp folded in)  ← first tracer bullet
`@collab/core` exposes markdown/MDX render, Nav, Entry Page precedence, Orama search, and
frontmatter/headings. `@collab/local` serves a file or folder over Hono with file-watch +
live-reload and an SSR'd Preact reading view. `collab <path>` renders local-first with no
account, token, or network (ADR-0010). Reuses mdttp wholesale — no DB, no blob store, no
comments. Proves the shared core + CLI spine and ships a usable tool on day one.

> **Deviation (as built):** to reuse mdttp wholesale, M1's reading-view chrome is still
> mdttp's **string-template** layout (`@collab/local/src/render/layout.ts`), not the
> `preact-render-to-string` SSR the stack calls for (§1). The content HTML is already
> produced by the shared `@collab/core` render pipeline; only the surrounding chrome
> (nav/toc/search shell) remains string templates. Converting the chrome to Preact JSX is
> a deferred follow-up — it's a presentation refactor with no effect on the core engine,
> the CLI spine, or the hosted Viewer (which is a separate Preact+Vite SPA per §1).

### M2 — Share: upload → host → view (single Markdown Page, public)  ← first hosted tracer bullet
- `core`: markdown ingest → rendered HTML + Source Map; content-address + store.
- `server`: `POST /sites` (create + first owner token), serve Page on content origin.
- `cli`: `collab share <file.md>` → prints Share URL + stores token.
- `web`: viewer loads Share URL, renders the Page inside the sandboxed iframe.
- No comments yet. Proves CLI → API → blob store → content origin → iframe.

### M3 — Sites (folders / zips)
Input auto-detection (file/folder/zip); manifest build; Entry Page precedence; Nav
tree; Asset serving; relative-link rewriting; content-hash wire negotiation
(`HEAD`/batch "which hashes do you have"); Provenance capture in the CLI/MCP.

### M4 — HTML Pages + unified isolation
HTML ingest via parse5 (+ source locations); both kinds render in the same
cross-origin sandboxed iframe; finalize the `bridge` protocol; per-Site content
subdomain + CSP/referrer headers.

### M5 — Anchoring + public comments (Threads)
- `bridge`: capture selection in iframe → build a **unique** anchor (text-quote with
  context expansion + source range + xpath/css) → postMessage to parent.
- `core`: anchor build/resolve; uniqueness-by-construction.
- `server` + `web`: create Conversation (public Thread), flat Comments, Reactions,
  Resolve/reopen, page-level comments; anonymous **Viewer** mint + display name
  (localStorage); Identity rendering with agent badge.

### M6 — Versioning UX
Re-upload → new Version; comment migration via text-quote; **Outdated** rail; Latest
pointer + per-Version permalinks; **Diff** (source-level, Last Seen vs Latest);
viewer-side Last Seen tracking; summary counts.

### M7 — Agent surface
REST verb set finalized; MCP server with parity (`upload`, `list_comments`
[`--unresolved|--since|--mentions`], `comment`, `reply`, `react`, `resolve|reopen`,
`list_versions`, `diff`, `delete`); Owner-scoped Agent URL; **Agent Prompt** copy
button; `collab.SKILL.md` + `/agent-docs` (with the prompt-injection trust framing);
@-mentions + routing filter.

### M8 — Private Chats + reviewer agents
Conversation `visibility`; private Chats scoped to a Viewer; viewer-scoped agent
tokens + their copy-prompt; chat panel UI; **Promotion** (curated messages →
public Thread); three-tier authorization enforced end-to-end. Chat transport: X2
baseline (agent-side via API) + X1 via polling (`list_chats --since`).

### M9 — Moderation & ops
Owner delete (any content); Share URL rotation; token rotation/revoke; Site state
(read-only / frozen); per-Viewer/IP rate limiting; operator retention/quota knobs
(all default-unset, infinite retention).

> **Scope (as built):** owner delete covers **Site** (`DELETE /sites/:slug`, cascades
> all metadata; content-addressed blobs are left in the store) and **Conversation**
> (`DELETE /sites/:slug/conversations/:id`, a moderation power over any Thread or Chat).
> **Version delete is deferred** — it collides with the immutable-Version design and the
> comment→version bindings, so keep-last-N pruning is out of scope too. Site state gates
> *public* mutations only (Chats are the Viewer's own workspace): `read_only` disables new
> public comments while allowing reactions/resolve; `frozen` locks all public-Thread
> mutations. Retention is **upload-time caps only** (`COLLAB_MAX_FILE_BYTES` /
> `MAX_SITE_BYTES` / `MAX_FILE_COUNT`, all default-unset → infinite retention); background
> inactivity-TTL and keep-last-N GC are deferred. Rate limiting is an in-memory fixed
> window (default 20 comment-creates/60s per Viewer/IP), on by default and injectable
> (`COLLAB_RATELIMIT_*`). Owner ops verbs available to agents (owner tier) are limited to
> `set_state` + `delete_conversation`; rotate-share/rotate-token/delete-site are
> human-only (CLI + web owner panel), by design.

### M10 — GitHub mirror (PR-backed Sites) (ADR-0008, ADR-0009)
Depends on M8 (visibility gates the backend). Operator-level opt-in; the end-user
"no config" promise is untouched.
- **Content sources:** generalize upload to `local | ref (branch/tag/commit) | pr`;
  `@collab/github` fetches bytes at a ref/PR head (clean Provenance, no dirty-tree
  problem). "Site from PR" scopes Pages to the PR's changed md/html files.
- **`MirrorProvider` port** in `core`; GitHub impl in `@collab/github`; `server` routes
  domain events to providers where `appliesTo` (PR-backed + public) matches. DB stays
  authoritative; GitHub is a projection.
- **Outbound:** bot (GitHub App) authors public-Thread comments with the native Identity
  in the body; source-range → PR review comment `{commit, path, line range, side}`;
  out-of-diff comments degrade best-effort to a file-level quoted comment. Promotion is
  the push-to-GitHub trigger.
- **Inbound:** webhooks (`*_review_comment`, `issue_comment`, `*_review`, `synchronize`)
  + reconciliation poll + poll-only fallback for firewalled self-hosts; GitHub authors →
  `source: github` Identities; PR-head advance (in-scope Page changed) → new Version via
  existing migration; native "outdated"/resolve ↔ **Outdated**/**Resolved**.
- **Conflict/lifecycle:** origin owns the comment (read-only on the other side);
  `comment_mirrors` dedups the loop; resolve last-writer-wins; reactions import-only;
  failures degrade to DB-only; deleted bot comments are respected (detached, not
  resurrected); PR merged/closed offers freeze, **PR locked auto-freezes**.

## 6. Notifications

v1 = **pull** only: `list_comments --since` + summary counts (free from existing
queries). Design the cursor (`after=<id>`) and event shape now so **push (SSE)** drops
in later with Chat as its first consumer (deferred). The **GitHub mirror webhook** (M10)
is the first concrete inbound push source — inbound mirror events feed the same SSE
fan-out, so the event shape should accommodate them.

## 7. Cross-cutting

- **Testing:** `core` unit tests (render/source-map/anchor/migration are the
  high-risk, high-value targets); server integration tests against ephemeral
  Postgres+MinIO; a Playwright smoke test for select→comment→migrate.
- **Security:** origin separation, CSP, `noindex`, `no-referrer`, hashed tokens,
  rate limiting; treat all hosted content as untrusted — hosted Pages are always static
  HTML and collab never executes uploaded MDX/JS (ADR-0012).
- **DX / "dirt simple":** single `collab <path>` command for Local Preview, `collab share`
  to publish; zero required config; `docker compose up` for a full local instance.

## 8. Risks / things to validate early

1. **Source Map fidelity** for markdown selections that span nodes, and HTML
   text-node offset → source line/col via parse5 (spike in M2/M4).
2. **Cross-frame selection + anchor resolution** ergonomics over postMessage (M5).
3. **Anchor uniqueness/migration** quality on real LLM doc edits — build a fixture
   corpus of v1→v2 diffs and measure migrate vs Outdated accuracy.
4. **Per-Site content origins** (subdomain wildcard TLS + routing) in the chosen host.
5. **GitHub comment-region constraint** (M10): how often real review selections fall on
   lines GitHub's review-comment API rejects (outside the diff), to size how much the
   best-effort file-level fallback actually carries. Spike against real PRs.

## 9. Suggested first PR

M0 + M1 as one stack: monorepo skeleton (folding mdttp in), the `@collab/core`
extraction, and the `collab <path>` **Local Preview** spine — a usable tool on its own.
The hosted tracer bullet (M2: `collab share` → upload → host → view) builds on that core.

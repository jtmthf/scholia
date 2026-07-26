// The viewer talks to the REST API over CORS. In dev that's the local server
// on :8787; in prod it's the app origin. Page content is loaded from the
// absolute `contentBase` the API returns (the content origin), not from here.
export const API_BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:8787").replace(
  /\/+$/,
  "",
);

export interface NavNode {
  type: "file" | "dir";
  title: string;
  urlPath: string;
  fsPath: string;
  order: number;
  children?: NavNode[];
}

export interface PageMeta {
  path: string;
  kind: "markdown" | "html" | "asset";
  title: string;
}

export interface SiteMeta {
  slug: string;
  state: "open" | "read_only" | "frozen";
  /** The Version being viewed (== latestVersion unless a `?v=` permalink). */
  version: number;
  latestVersion: number;
  isLatest: boolean;
  entryPath: string;
  contentBase: string;
  nav: NavNode[];
  pages: PageMeta[];
  /** M10: PR-backed Site binding (null for local / non-PR Sites). */
  mirrorBinding?: { provider: string; repo: string; prNumber: number };
  /** M10: GitHub App slug when the server has GitHub integration configured. */
  githubAppSlug?: string;
}

export class SiteNotFoundError extends Error {
  constructor(slug: string) {
    super(`No Site at "${slug}".`);
    this.name = "SiteNotFoundError";
  }
}

// Load Site metadata. Pass a `version` ordinal for a per-Version permalink
// (read-only historical view, CONTEXT "Latest"); omit for Latest.
export async function fetchSite(slug: string, version?: number): Promise<SiteMeta> {
  const qs = version !== undefined ? `?v=${version}` : "";
  const res = await fetch(`${API_BASE}/sites/${encodeURIComponent(slug)}${qs}`);
  if (res.status === 404) throw new SiteNotFoundError(slug);
  if (!res.ok) throw new Error(`Failed to load Site (${res.status}).`);
  return (await res.json()) as SiteMeta;
}

// ----------------------------------------------------------------------------
// M6 — Versioning UX: Version list, Diff, Last Seen, "new since" summary.
// ----------------------------------------------------------------------------

export interface VersionSummary {
  ordinal: number;
  createdAt: string;
  provenance: { remote?: string; sha?: string; branch?: string; dirty?: boolean } | null;
  isLatest: boolean;
}

export interface ViewerSummary {
  latestVersion: number;
  lastSeenVersion: number | null;
  newVersions: number;
  newComments: number;
}

export type PageChange = "added" | "removed" | "modified" | "unchanged";

export interface ChangedPage {
  path: string;
  kind: "markdown" | "html" | "asset";
  status: PageChange;
}

export type DiffLineType = "context" | "add" | "del";

export interface DiffLine {
  type: DiffLineType;
  oldLine?: number;
  newLine?: number;
  text: string;
}

export interface LineDiff {
  lines: DiffLine[];
  added: number;
  removed: number;
  unchanged: boolean;
}

export async function listVersions(slug: string): Promise<VersionSummary[]> {
  const res = await fetch(`${API_BASE}/sites/${encodeURIComponent(slug)}/versions`);
  const { versions } = await jsonOrThrow<{ versions: VersionSummary[] }>(res, "List versions");
  return versions;
}

export async function fetchSummary(slug: string, viewerId: string | null): Promise<ViewerSummary> {
  const qs = viewerId ? `?viewerId=${encodeURIComponent(viewerId)}` : "";
  const res = await fetch(`${API_BASE}/sites/${encodeURIComponent(slug)}/summary${qs}`);
  return jsonOrThrow(res, "Fetch summary");
}

// Record the Viewer's Last Seen Version (defaults to Latest server-side).
export async function recordLastSeen(
  slug: string,
  viewerId: string,
  version?: number,
): Promise<void> {
  const res = await fetch(`${API_BASE}/sites/${encodeURIComponent(slug)}/last-seen`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ viewerId, ...(version !== undefined ? { version } : {}) }),
  });
  if (!res.ok) throw new Error(`Record last-seen failed (${res.status}).`);
}

// The changed-Pages summary between two Versions (no per-line hunks).
export async function fetchChangedPages(
  slug: string,
  from: number,
  to: number,
): Promise<{ from: number; to: number; pages: ChangedPage[] }> {
  const res = await fetch(
    `${API_BASE}/sites/${encodeURIComponent(slug)}/diff?from=${from}&to=${to}`,
  );
  return jsonOrThrow(res, "Fetch diff");
}

// The source-level line diff for one Page between two Versions.
export async function fetchPageDiff(
  slug: string,
  from: number,
  to: number,
  path: string,
): Promise<{ from: number; to: number; path: string; status: PageChange; diff: LineDiff }> {
  const res = await fetch(
    `${API_BASE}/sites/${encodeURIComponent(slug)}/diff?from=${from}&to=${to}&path=${encodeURIComponent(path)}`,
  );
  return jsonOrThrow(res, "Fetch page diff");
}

// ----------------------------------------------------------------------------
// M5 — Anchoring + public comments (Threads)
//
// The viewer mints an anonymous Viewer (id held in localStorage; "private from
// casual view", not secure — CONTEXT "Viewer") and uses it to author public
// Threads. The author Identity is rendered with an agent badge when kind ===
// "agent" (M5 only produces human viewers; agents arrive via the API in M7).
// ----------------------------------------------------------------------------

export interface Identity {
  name: string;
  kind: "human" | "agent";
  tier: "owner" | "viewer";
  onBehalfOf?: string;
  source: "native" | "github";
}

export interface TextQuote {
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface Anchor {
  textQuote: TextQuote;
  sourceRange?: { start: number; end: number };
  xpath?: string;
  css?: string;
}

// Grouped reaction for one emoji on one comment (fixed review palette).
export interface ReactionGroup {
  emoji: string;
  count: number;
  /** Whether the current Viewer has this reaction (for toggle UI). */
  mine: boolean;
}

export interface CommentDTO {
  id: string;
  author: Identity;
  /** Empty string when the comment is a tombstone (`deleted` true). */
  body: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  /** Whether the current Viewer authored this comment (for edit/delete UI). */
  mine: boolean;
  reactions: ReactionGroup[];
}

export interface ConversationDTO {
  id: string;
  /** The Page this Thread is on; null for a Site/page-level Thread. */
  pagePath: string | null;
  /** Anchored span; null for a page-level Thread (no highlight). */
  anchor: Anchor | null;
  anchorStatus: "live" | "outdated";
  /** Ordinal of the Version this Thread was created on (Outdated permalink). */
  createdOrdinal: number;
  resolved: boolean;
  resolvedBy: string | null;
  /** Private Chat (owning Viewer + its agents only) vs public Thread — CONTEXT. */
  visibility: "public" | "private";
  comments: CommentDTO[];
}

// The anchor candidate the viewer submits when starting an anchored Thread.
// Mirrors `@scholia/bridge` SelectionEvent.candidate: the uniquely-expanded quote
// plus the `data-sm` ids it intersects (server maps those to a source range).
export interface AnchorInput {
  textQuote: TextQuote;
  smIds: number[];
  xpath?: string;
  css?: string;
}

// The fixed review-oriented reaction palette (CONTEXT "Reaction").
export const REACTION_PALETTE = ["👍", "👎", "✅", "👀", "🎉", "❤️"] as const;

async function jsonOrThrow<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what} failed (${res.status}).`);
  return (await res.json()) as T;
}

// Mint (or no-op return) an anonymous Viewer for this Site. The caller persists
// the returned id in localStorage.
export async function mintViewer(slug: string): Promise<{ viewerId: string }> {
  const res = await fetch(`${API_BASE}/sites/${encodeURIComponent(slug)}/viewers`, {
    method: "POST",
  });
  return jsonOrThrow(res, "Mint viewer");
}

// List public Threads for a Page (omit `pagePath` for Site/page-level Threads).
// Passing `viewerId` lets the server flag `mine` on comments and reactions.
export async function listConversations(
  slug: string,
  pagePath: string | null,
  viewerId: string | null,
): Promise<ConversationDTO[]> {
  const params = new URLSearchParams();
  if (pagePath) params.set("path", pagePath);
  if (viewerId) params.set("viewerId", viewerId);
  const qs = params.toString();
  const res = await fetch(
    `${API_BASE}/sites/${encodeURIComponent(slug)}/conversations${qs ? `?${qs}` : ""}`,
  );
  return jsonOrThrow(res, "List conversations");
}

// Start a Conversation: anchored when `anchor` is given, page-level otherwise.
// `visibility` defaults to public server-side (a Thread); pass "private" for a
// Chat (or use createChat, which delegates here).
export async function createConversation(
  slug: string,
  input: {
    pagePath: string | null;
    anchor: AnchorInput | null;
    body: string;
    viewerId: string;
    displayName: string;
    visibility?: "public" | "private";
  },
): Promise<ConversationDTO> {
  const res = await fetch(`${API_BASE}/sites/${encodeURIComponent(slug)}/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return jsonOrThrow(res, "Create conversation");
}

// Start a private Chat (CONTEXT "Chat") — same body as a Thread but private, so
// it's visible only to this Viewer and the agents it admits. Delegates to
// createConversation with visibility pinned to "private".
export async function createChat(
  slug: string,
  input: {
    pagePath: string | null;
    anchor: AnchorInput | null;
    body: string;
    viewerId: string;
    displayName: string;
  },
): Promise<ConversationDTO> {
  return createConversation(slug, { ...input, visibility: "private" });
}

// List the current Viewer's private Chats for a Page (CONTEXT "Chat"). Possession
// of the viewerId authorizes; the server returns only Chats owned by that Viewer.
export async function listChats(
  slug: string,
  pagePath: string | null,
  viewerId: string,
): Promise<ConversationDTO[]> {
  const params = new URLSearchParams();
  if (pagePath) params.set("path", pagePath);
  params.set("viewerId", viewerId);
  const res = await fetch(
    `${API_BASE}/sites/${encodeURIComponent(slug)}/chats?${params.toString()}`,
  );
  return jsonOrThrow(res, "List chats");
}

// Promote a Chat to a public Thread (CONTEXT "Promotion"): the owning Viewer
// picks which Comments become public (+ an optional summary). Flips the
// Conversation to public in place and returns it as a Thread.
export async function promote(
  slug: string,
  conversationId: string,
  input: { commentIds: string[]; summary?: string; viewerId: string },
): Promise<ConversationDTO> {
  const res = await fetch(
    `${API_BASE}/sites/${encodeURIComponent(slug)}/conversations/${conversationId}/promote`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return jsonOrThrow(res, "Promote conversation");
}

// Mint a Viewer-scoped agent token (CONTEXT "Agent URL" — Viewer scope). One
// token per Viewer; the server re-mints on each call. Possession of the viewerId
// authorizes. Grants read + this Viewer's Chats + public commenting, no Owner
// powers.
export async function mintViewerAgentToken(
  slug: string,
  viewerId: string,
): Promise<{ token: string; agentUrl: string }> {
  const res = await fetch(
    `${API_BASE}/sites/${encodeURIComponent(slug)}/viewers/${encodeURIComponent(viewerId)}/agent-token`,
    { method: "POST" },
  );
  return jsonOrThrow(res, "Mint viewer agent token");
}

export async function addComment(
  slug: string,
  conversationId: string,
  input: { body: string; viewerId: string; displayName: string },
): Promise<CommentDTO> {
  const res = await fetch(
    `${API_BASE}/sites/${encodeURIComponent(slug)}/conversations/${conversationId}/comments`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return jsonOrThrow(res, "Add comment");
}

export async function editComment(
  slug: string,
  commentId: string,
  input: { body: string; viewerId: string },
): Promise<CommentDTO> {
  const res = await fetch(`${API_BASE}/sites/${encodeURIComponent(slug)}/comments/${commentId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return jsonOrThrow(res, "Edit comment");
}

export async function deleteComment(
  slug: string,
  commentId: string,
  viewerId: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/sites/${encodeURIComponent(slug)}/comments/${commentId}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ viewerId }),
  });
  if (!res.ok) throw new Error(`Delete comment failed (${res.status}).`);
}

// Resolve or reopen a Thread (anyone may, CONTEXT "Resolved").
export async function setResolved(
  slug: string,
  conversationId: string,
  resolved: boolean,
  input: { viewerId: string; displayName: string },
): Promise<ConversationDTO> {
  const res = await fetch(
    `${API_BASE}/sites/${encodeURIComponent(slug)}/conversations/${conversationId}/resolve`,
    {
      method: resolved ? "POST" : "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return jsonOrThrow(res, "Resolve conversation");
}

// ----------------------------------------------------------------------------
// M9 — Moderation & ops (owner-authed). These carry the owner token as a Bearer
// credential (never `?token=`), matching the server's owner-only management gate.
// ----------------------------------------------------------------------------

export type SiteState = "open" | "read_only" | "frozen";

function ownerHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

// PATCH /sites/:slug/state — set the moderation posture.
export async function setSiteState(
  slug: string,
  token: string,
  state: SiteState,
): Promise<{ slug: string; state: SiteState }> {
  const res = await fetch(`${API_BASE}/sites/${encodeURIComponent(slug)}/state`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...ownerHeaders(token) },
    body: JSON.stringify({ state }),
  });
  return jsonOrThrow(res, "Set site state");
}

// POST /sites/:slug/rotate-share — mint a fresh Share URL slug.
export async function rotateShare(
  slug: string,
  token: string,
): Promise<{ slug: string; shareUrl: string }> {
  const res = await fetch(`${API_BASE}/sites/${encodeURIComponent(slug)}/rotate-share`, {
    method: "POST",
    headers: { ...ownerHeaders(token) },
  });
  return jsonOrThrow(res, "Rotate share URL");
}

// POST /sites/:slug/rotate-token — mint a fresh owner token (revokes the old one).
export async function rotateOwnerToken(
  slug: string,
  token: string,
): Promise<{ token: string; agentUrl: string }> {
  const res = await fetch(`${API_BASE}/sites/${encodeURIComponent(slug)}/rotate-token`, {
    method: "POST",
    headers: { ...ownerHeaders(token) },
  });
  return jsonOrThrow(res, "Rotate owner token");
}

// DELETE /sites/:slug — owner-delete the whole Site.
export async function deleteSite(slug: string, token: string): Promise<void> {
  const res = await fetch(`${API_BASE}/sites/${encodeURIComponent(slug)}`, {
    method: "DELETE",
    headers: { ...ownerHeaders(token) },
  });
  if (!res.ok) throw new Error(`Delete site failed (${res.status}).`);
}

// DELETE /sites/:slug/conversations/:id — owner-delete a Thread or Chat (moderation).
export async function ownerDeleteConversation(
  slug: string,
  token: string,
  conversationId: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/sites/${encodeURIComponent(slug)}/conversations/${conversationId}`,
    { method: "DELETE", headers: { ...ownerHeaders(token) } },
  );
  if (!res.ok) throw new Error(`Delete conversation failed (${res.status}).`);
}

// Toggle a reaction (add if absent, remove if the Viewer already reacted).
export async function toggleReaction(
  slug: string,
  commentId: string,
  emoji: string,
  input: { viewerId: string; displayName: string },
): Promise<ReactionGroup[]> {
  const res = await fetch(
    `${API_BASE}/sites/${encodeURIComponent(slug)}/comments/${commentId}/reactions`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emoji, ...input }),
    },
  );
  return jsonOrThrow(res, "Toggle reaction");
}

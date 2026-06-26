// The viewer talks to the REST API over CORS. In dev that's the local server
// on :8787; in prod it's the app origin. Page content is loaded from the
// absolute `contentBase` the API returns (the content origin), not from here.
const API_BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:8787").replace(/\/+$/, "");

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
  version: number;
  entryPath: string;
  contentBase: string;
  nav: NavNode[];
  pages: PageMeta[];
}

export class SiteNotFoundError extends Error {
  constructor(slug: string) {
    super(`No Site at "${slug}".`);
    this.name = "SiteNotFoundError";
  }
}

export async function fetchSite(slug: string): Promise<SiteMeta> {
  const res = await fetch(`${API_BASE}/sites/${encodeURIComponent(slug)}`);
  if (res.status === 404) throw new SiteNotFoundError(slug);
  if (!res.ok) throw new Error(`Failed to load Site (${res.status}).`);
  return (await res.json()) as SiteMeta;
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
  resolved: boolean;
  resolvedBy: string | null;
  comments: CommentDTO[];
}

// The anchor candidate the viewer submits when starting an anchored Thread.
// Mirrors `@collab/bridge` SelectionEvent.candidate: the uniquely-expanded quote
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

// Start a public Thread: anchored when `anchor` is given, page-level otherwise.
export async function createConversation(
  slug: string,
  input: {
    pagePath: string | null;
    anchor: AnchorInput | null;
    body: string;
    viewerId: string;
    displayName: string;
  },
): Promise<ConversationDTO> {
  const res = await fetch(`${API_BASE}/sites/${encodeURIComponent(slug)}/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return jsonOrThrow(res, "Create conversation");
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
  const res = await fetch(
    `${API_BASE}/sites/${encodeURIComponent(slug)}/comments/${commentId}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return jsonOrThrow(res, "Edit comment");
}

export async function deleteComment(
  slug: string,
  commentId: string,
  viewerId: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/sites/${encodeURIComponent(slug)}/comments/${commentId}`,
    {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewerId }),
    },
  );
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

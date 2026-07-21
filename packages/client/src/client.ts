import type { CollectedFile } from "./collect.js";
import type { SiteCredential } from "./credentials.js";

export interface CollabClientOptions {
  server: string;
  /** Bearer token for owner-tier agent writes. */
  token?: string;
  /** Site slug for operations that target a specific site. */
  slug?: string;
}

export interface SiteCreatedResult {
  slug: string;
  shareUrl: string;
  token: string;
  entryPath: string;
  mirrorBinding?: { provider: string; repo: string; prNumber: number };
}

export interface VersionAddedResult {
  slug: string;
  shareUrl: string;
  version: number;
  entryPath: string;
  migration: { migrated: number; outdated: number };
}

export interface Provenance {
  remote?: string;
  sha?: string;
  branch?: string;
  dirty?: boolean;
}

export interface FileManifestEntry {
  path: string;
  kind: string;
  contentHash: string;
}

export interface TextQuote {
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface Anchor {
  textQuote?: TextQuote;
  sourceRange?: { start: number; end: number };
  xpath?: string;
  css?: string;
}

export interface ListCommentsFilter {
  unresolved?: boolean;
  since?: string;
  mentions?: string;
}

export interface ListChatsFilter {
  since?: string;
  path?: string;
}

export interface SiteCommentDTO {
  conversationId: string;
  commentId: string;
  pagePath: string | null;
  anchor: Anchor | null;
  anchorStatus: string;
  resolved: boolean;
  version: number;
  createdOrdinal: number;
  author: { name: string; kind: string; tier: string };
  body: string;
  createdAt: string;
  editedAt: string | null;
  mentions: string[];
  reactions: Array<{ emoji: string; count: number }>;
}

export interface ListCommentsResult {
  comments: SiteCommentDTO[];
}

export interface CreateThreadOptions {
  pagePath?: string;
  anchor?: Anchor;
  body: string;
  label?: string;
}

export interface CreateChatOptions {
  pagePath?: string;
  anchor?: Anchor;
  body: string;
  label?: string;
}

export interface ReplyOptions {
  conversationId: string;
  body: string;
  label?: string;
}

export interface ReactOptions {
  commentId: string;
  emoji: string;
  label?: string;
}

export interface ResolveOptions {
  conversationId: string;
  label?: string;
}

export interface DeleteCommentOptions {
  commentId: string;
}

export interface DiffOptions {
  from: number;
  to?: number;
  path?: string;
}

// ---- M9: Moderation & ops ----

export type SiteState = "open" | "read_only" | "frozen";

export interface TokenSummary {
  id: string;
  kind: "owner" | "viewer";
  label: string | null;
  viewerId: string | null;
  createdAt: string;
  revoked: boolean;
}

export class CollabClient {
  private server: string;
  private token: string | undefined;
  private slug: string | undefined;

  constructor({ server, token, slug }: CollabClientOptions) {
    this.server = server.replace(/\/+$/, "");
    this.token = token;
    this.slug = slug;
  }

  private async apiFetch(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, init).catch((err: Error) => {
      throw new Error(`network error reaching ${url}: ${err.message}`);
    });
  }

  private authHeaders(): Record<string, string> {
    if (!this.token) throw new Error("owner token required for this operation");
    return { authorization: `Bearer ${this.token}` };
  }

  private requireSlug(): string {
    if (!this.slug) throw new Error("site slug required — pass slug to CollabClient constructor");
    return this.slug;
  }

  // Negotiate with the server which blobs are missing, then upload them.
  async uploadBlobs(files: CollectedFile[]): Promise<void> {
    const hashes = [...new Set(files.map((f) => f.contentHash))];
    const diffRes = await this.apiFetch(`${this.server}/blobs/diff`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hashes }),
    });
    if (!diffRes.ok)
      throw new Error(`/blobs/diff failed (${diffRes.status}): ${await diffRes.text()}`);
    const { missing } = (await diffRes.json()) as { missing: string[] };

    const byHash = new Map(files.map((f) => [f.contentHash, f.bytes]));
    for (const hash of missing) {
      const bytes = byHash.get(hash);
      if (!bytes) continue;
      const upRes = await this.apiFetch(`${this.server}/blobs/${hash}`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: bytes,
      });
      if (!upRes.ok)
        throw new Error(`PUT /blobs/${hash} failed (${upRes.status}): ${await upRes.text()}`);
    }
  }

  // Create a new Site from pre-uploaded blobs.
  async createSite(
    files: CollectedFile[],
    provenance?: Provenance,
  ): Promise<SiteCreatedResult> {
    const manifest: FileManifestEntry[] = files.map(({ path, kind, contentHash }) => ({
      path,
      kind,
      contentHash,
    }));
    const res = await this.apiFetch(`${this.server}/sites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentSource: { kind: "local" }, provenance, files: manifest }),
    });
    if (!res.ok) throw new Error(`POST /sites failed (${res.status}): ${await res.text()}`);
    return (await res.json()) as SiteCreatedResult;
  }

  // Create a new Site from a ref or PR content source — the server fetches the
  // bytes itself, so no blob negotiation is needed (ADR-0009). `source` is either
  // {kind:"ref",repo,ref} or {kind:"pr",repo,prNumber}. A PR source sets the
  // Site's mirrorBinding so public Threads mirror to the GitHub PR.
  async createSiteFromSource(
    source: { kind: "ref"; repo: string; ref: string } | { kind: "pr"; repo: string; prNumber: number },
    provenance?: Provenance,
  ): Promise<SiteCreatedResult> {
    const res = await this.apiFetch(`${this.server}/sites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentSource: source, provenance }),
    });
    if (!res.ok) throw new Error(`POST /sites failed (${res.status}): ${await res.text()}`);
    return (await res.json()) as SiteCreatedResult;
  }

  // Add a new Version to an existing Site (requires owner token).
  async addVersion(
    slug: string,
    files: CollectedFile[],
    provenance?: Provenance,
  ): Promise<VersionAddedResult> {
    const manifest: FileManifestEntry[] = files.map(({ path, kind, contentHash }) => ({
      path,
      kind,
      contentHash,
    }));
    const res = await this.apiFetch(`${this.server}/sites/${slug}/versions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.authHeaders(),
      },
      body: JSON.stringify({ contentSource: { kind: "local" }, provenance, files: manifest }),
    });
    if (!res.ok)
      throw new Error(`POST /sites/${slug}/versions failed (${res.status}): ${await res.text()}`);
    return (await res.json()) as VersionAddedResult;
  }

  // Re-fetch a ref or PR content source and append a new Version (owner-authed).
  // The server fetches the bytes; the client just sends the content source spec.
  // For a PR-backed Site this advances to the latest PR head.
  async refetchSource(
    slug: string,
    source: { kind: "ref"; repo: string; ref: string } | { kind: "pr"; repo: string; prNumber: number },
    provenance?: Provenance,
  ): Promise<VersionAddedResult> {
    const res = await this.apiFetch(`${this.server}/sites/${slug}/versions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.authHeaders(),
      },
      body: JSON.stringify({ contentSource: source, provenance }),
    });
    if (!res.ok)
      throw new Error(`POST /sites/${slug}/versions failed (${res.status}): ${await res.text()}`);
    return (await res.json()) as VersionAddedResult;
  }

  // GET /sites/:slug/comments — flat comment list with optional filters.
  // No auth required (share-URL-gated read surface).
  async listComments(filter: ListCommentsFilter = {}): Promise<ListCommentsResult> {
    const slug = this.requireSlug();
    const params = new URLSearchParams();
    if (filter.unresolved) params.set("unresolved", "");
    if (filter.since) params.set("since", filter.since);
    if (filter.mentions) params.set("mentions", filter.mentions);
    const qs = params.toString() ? `?${params.toString()}` : "";
    const res = await this.apiFetch(`${this.server}/sites/${slug}/comments${qs}`, {
      method: "GET",
    });
    if (!res.ok)
      throw new Error(`GET /sites/${slug}/comments failed (${res.status}): ${await res.text()}`);
    return (await res.json()) as ListCommentsResult;
  }

  // GET /sites/:slug/chats — the viewer's own private Chats (viewer token).
  // Owner tokens are refused by the endpoint; that's expected.
  async listChats(filter: ListChatsFilter = {}): Promise<{ chats: unknown[] }> {
    const slug = this.requireSlug();
    const params = new URLSearchParams();
    if (filter.since) params.set("since", filter.since);
    if (filter.path) params.set("path", filter.path);
    const qs = params.toString() ? `?${params.toString()}` : "";
    const res = await this.apiFetch(`${this.server}/sites/${slug}/chats${qs}`, {
      method: "GET",
      headers: { ...this.authHeaders() },
    });
    if (!res.ok)
      throw new Error(`GET /sites/${slug}/chats failed (${res.status}): ${await res.text()}`);
    const chats = (await res.json()) as unknown[];
    return { chats };
  }

  // POST /sites/:slug/conversations — shared thread/chat request builder.
  private async postConversation(
    opts: CreateThreadOptions,
    visibility: "public" | "private",
  ): Promise<unknown> {
    const slug = this.requireSlug();
    const res = await this.apiFetch(`${this.server}/sites/${slug}/conversations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.authHeaders(),
      },
      body: JSON.stringify({
        pagePath: opts.pagePath ?? null,
        anchor: opts.anchor ?? null,
        body: opts.body,
        label: opts.label,
        visibility,
      }),
    });
    if (!res.ok)
      throw new Error(
        `POST /sites/${slug}/conversations failed (${res.status}): ${await res.text()}`,
      );
    return res.json();
  }

  // Create a public Thread (agent-authed).
  async createThread(opts: CreateThreadOptions): Promise<unknown> {
    return this.postConversation(opts, "public");
  }

  // Create a private Chat owned by the viewer behind the token (viewer-authed).
  async createChat(opts: CreateChatOptions): Promise<unknown> {
    return this.postConversation(opts, "private");
  }

  // POST /sites/:slug/conversations/:id/comments — reply (agent-authed).
  async reply(opts: ReplyOptions): Promise<unknown> {
    const slug = this.requireSlug();
    const res = await this.apiFetch(
      `${this.server}/sites/${slug}/conversations/${opts.conversationId}/comments`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({ body: opts.body, label: opts.label }),
      },
    );
    if (!res.ok)
      throw new Error(
        `POST /sites/${slug}/conversations/${opts.conversationId}/comments failed (${res.status}): ${await res.text()}`,
      );
    return res.json();
  }

  // POST /sites/:slug/comments/:id/reactions — react (agent-authed).
  async react(opts: ReactOptions): Promise<unknown> {
    const slug = this.requireSlug();
    const res = await this.apiFetch(
      `${this.server}/sites/${slug}/comments/${opts.commentId}/reactions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({ emoji: opts.emoji, label: opts.label }),
      },
    );
    if (!res.ok)
      throw new Error(
        `POST /sites/${slug}/comments/${opts.commentId}/reactions failed (${res.status}): ${await res.text()}`,
      );
    return res.json();
  }

  // POST /sites/:slug/conversations/:id/resolve — mark resolved (agent-authed).
  async resolve(opts: ResolveOptions): Promise<unknown> {
    const slug = this.requireSlug();
    const res = await this.apiFetch(
      `${this.server}/sites/${slug}/conversations/${opts.conversationId}/resolve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({ label: opts.label }),
      },
    );
    if (!res.ok)
      throw new Error(
        `POST /sites/${slug}/conversations/${opts.conversationId}/resolve failed (${res.status}): ${await res.text()}`,
      );
    return res.json();
  }

  // DELETE /sites/:slug/conversations/:id/resolve — reopen (agent-authed).
  async reopen(opts: ResolveOptions): Promise<unknown> {
    const slug = this.requireSlug();
    const res = await this.apiFetch(
      `${this.server}/sites/${slug}/conversations/${opts.conversationId}/resolve`,
      {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({ label: opts.label }),
      },
    );
    if (!res.ok)
      throw new Error(
        `DELETE /sites/${slug}/conversations/${opts.conversationId}/resolve failed (${res.status}): ${await res.text()}`,
      );
    return res.json();
  }

  // DELETE /sites/:slug/comments/:id — owner-delete any comment (agent-authed).
  async deleteComment(opts: DeleteCommentOptions): Promise<void> {
    const slug = this.requireSlug();
    const res = await this.apiFetch(
      `${this.server}/sites/${slug}/comments/${opts.commentId}`,
      {
        method: "DELETE",
        headers: { ...this.authHeaders() },
      },
    );
    if (!res.ok)
      throw new Error(
        `DELETE /sites/${slug}/comments/${opts.commentId} failed (${res.status}): ${await res.text()}`,
      );
  }

  // GET /sites/:slug/versions — all versions, newest first.
  async listVersions(): Promise<unknown> {
    const slug = this.requireSlug();
    const res = await this.apiFetch(`${this.server}/sites/${slug}/versions`, {
      method: "GET",
    });
    if (!res.ok)
      throw new Error(
        `GET /sites/${slug}/versions failed (${res.status}): ${await res.text()}`,
      );
    return res.json();
  }

  // GET /sites/:slug/diff?from=<ord>&to=<ord>[&path=<pagePath>]
  async diff(opts: DiffOptions): Promise<unknown> {
    const slug = this.requireSlug();
    const params = new URLSearchParams({ from: String(opts.from) });
    if (opts.to !== undefined) params.set("to", String(opts.to));
    if (opts.path) params.set("path", opts.path);
    const res = await this.apiFetch(`${this.server}/sites/${slug}/diff?${params.toString()}`, {
      method: "GET",
    });
    if (!res.ok)
      throw new Error(`GET /sites/${slug}/diff failed (${res.status}): ${await res.text()}`);
    return res.json();
  }

  // ---- M9: Moderation & ops (owner-authed) ----

  // PATCH /sites/:slug/state — set the Site moderation posture.
  async setState(state: SiteState): Promise<{ slug: string; state: SiteState }> {
    const slug = this.requireSlug();
    const res = await this.apiFetch(`${this.server}/sites/${slug}/state`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...this.authHeaders() },
      body: JSON.stringify({ state }),
    });
    if (!res.ok)
      throw new Error(`PATCH /sites/${slug}/state failed (${res.status}): ${await res.text()}`);
    return (await res.json()) as { slug: string; state: SiteState };
  }

  // DELETE /sites/:slug — owner-delete the whole Site.
  async deleteSite(): Promise<void> {
    const slug = this.requireSlug();
    const res = await this.apiFetch(`${this.server}/sites/${slug}`, {
      method: "DELETE",
      headers: { ...this.authHeaders() },
    });
    if (!res.ok)
      throw new Error(`DELETE /sites/${slug} failed (${res.status}): ${await res.text()}`);
  }

  // DELETE /sites/:slug/conversations/:id — owner-delete a Thread or Chat.
  async deleteConversation(conversationId: string): Promise<void> {
    const slug = this.requireSlug();
    const res = await this.apiFetch(
      `${this.server}/sites/${slug}/conversations/${conversationId}`,
      { method: "DELETE", headers: { ...this.authHeaders() } },
    );
    if (!res.ok)
      throw new Error(
        `DELETE /sites/${slug}/conversations/${conversationId} failed (${res.status}): ${await res.text()}`,
      );
  }

  // POST /sites/:slug/rotate-share — mint a fresh Share URL slug.
  async rotateShare(): Promise<{ slug: string; shareUrl: string }> {
    const slug = this.requireSlug();
    const res = await this.apiFetch(`${this.server}/sites/${slug}/rotate-share`, {
      method: "POST",
      headers: { ...this.authHeaders() },
    });
    if (!res.ok)
      throw new Error(`POST /sites/${slug}/rotate-share failed (${res.status}): ${await res.text()}`);
    return (await res.json()) as { slug: string; shareUrl: string };
  }

  // POST /sites/:slug/rotate-token — mint a fresh owner token (revokes prior ones).
  async rotateToken(): Promise<{ token: string; agentUrl: string }> {
    const slug = this.requireSlug();
    const res = await this.apiFetch(`${this.server}/sites/${slug}/rotate-token`, {
      method: "POST",
      headers: { ...this.authHeaders() },
    });
    if (!res.ok)
      throw new Error(`POST /sites/${slug}/rotate-token failed (${res.status}): ${await res.text()}`);
    return (await res.json()) as { token: string; agentUrl: string };
  }

  // GET /sites/:slug/tokens — list this Site's tokens (metadata only).
  async listTokens(): Promise<{ tokens: TokenSummary[] }> {
    const slug = this.requireSlug();
    const res = await this.apiFetch(`${this.server}/sites/${slug}/tokens`, {
      method: "GET",
      headers: { ...this.authHeaders() },
    });
    if (!res.ok)
      throw new Error(`GET /sites/${slug}/tokens failed (${res.status}): ${await res.text()}`);
    return (await res.json()) as { tokens: TokenSummary[] };
  }

  // DELETE /sites/:slug/tokens/:id — revoke a single token.
  async revokeToken(tokenId: string): Promise<void> {
    const slug = this.requireSlug();
    const res = await this.apiFetch(`${this.server}/sites/${slug}/tokens/${tokenId}`, {
      method: "DELETE",
      headers: { ...this.authHeaders() },
    });
    if (!res.ok)
      throw new Error(
        `DELETE /sites/${slug}/tokens/${tokenId} failed (${res.status}): ${await res.text()}`,
      );
  }
}

// Resolve a SiteCredential for a given slug from the credential store.
export async function resolveCredential(slug: string): Promise<SiteCredential | undefined> {
  const { loadCredentials } = await import("./credentials.js");
  const store = await loadCredentials();
  return store[slug];
}

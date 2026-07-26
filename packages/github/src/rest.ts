// The GitHub REST/GraphQL surface `@scholia/github` needs for mirroring (ADR-0008/0009).
// One interface, two impls: `HttpGitHubApi` (real, App-installation authed) and
// `FakeGitHubApi` (in-memory record + assertions for tests). The provider layer
// (provider.ts) and fetch.ts depend only on this interface.

import { InstallationTokenCache, mintAppJwt, type InstallationToken } from "./auth.js";

export interface RepoPath {
  owner: string;
  name: string;
}

export interface PrHead {
  sha: string;
  ref: string;
}

export interface PullRequestInfo {
  number: number;
  state: "open" | "closed";
  merged: boolean;
  mergedAt: string | null;
  head: PrHead;
  title: string;
}

export interface PrFile {
  filename: string;
  status: "added" | "modified" | "removed" | "renamed" | "changed" | string;
  /** Blob SHA at the PR head for this file. */
  sha: string;
}

export interface PrReviewComment {
  id: number;
  nodeId: string;
  url: string;
  path: string | null;
  line: number | null;
  side: "LEFT" | "RIGHT" | null;
  originalLine: number | null;
  originalSide: "LEFT" | "RIGHT" | null;
  inReplyToId: number | null;
  commitId: string;
  user: { login: string; avatarUrl: string | null };
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedComment {
  id: number;
  nodeId: string;
  url: string;
  /** The review thread node id this comment opened (for resolve). Best-effort. */
  threadNodeId?: string;
}

export interface CreateReviewCommentInput {
  body: string;
  commitId: string;
  path: string;
  /** The end line (GitHub's `line`). */
  line: number;
  side: "LEFT" | "RIGHT";
  /** The start line for a multi-line comment (optional). */
  startLine?: number;
  startSide?: "LEFT" | "RIGHT";
  /** Reply to an existing review comment (inReplyTo). */
  inReplyTo?: number;
}

export interface ReviewThread {
  id: string; // GraphQL node id — passed to resolveReviewThread
  isResolved: boolean;
  comments: Array<{ databaseId: number; path: string | null; line: number | null }>;
}

// The interface everything depends on. Methods are repo-scoped; an installation
// token is resolved internally for the repo. Throws `GitHubApiError` on non-2xx.
export interface GitHubApi {
  /** List repos (owner/name) accessible to the current installation. */
  listInstallationRepos(): Promise<RepoPath[]>;
  /** PR metadata including merge state and head sha. */
  getPullRequest(repo: RepoPath, prNumber: number): Promise<PullRequestInfo>;
  /** Files changed by the PR (paginated internally). Caller filters md/html. */
  listPrFiles(repo: RepoPath, prNumber: number): Promise<PrFile[]>;
  /** File contents at a ref (commit/branch/tag/path). Returns raw bytes. */
  getFileContent(repo: RepoPath, path: string, ref: string): Promise<Uint8Array>;
  /** Review comments on the PR; `since` is an ISO timestamp or undefined. */
  listPrReviewComments(
    repo: RepoPath,
    prNumber: number,
    since?: string,
  ): Promise<PrReviewComment[]>;
  /** A single review comment by id (for deleted/edited dedup). */
  getPrReviewComment(repo: RepoPath, commentId: number): Promise<PrReviewComment | null>;
  /** Create a PR review comment anchored to a diff line; throws on out-of-diff. */
  createPrReviewComment(
    repo: RepoPath,
    prNumber: number,
    input: CreateReviewCommentInput,
  ): Promise<CreatedComment>;
  /** File-level / out-of-diff fallback comment on the PR conversation. */
  createIssueComment(repo: RepoPath, prNumber: number, body: string): Promise<CreatedComment>;
  /** Review threads (GraphQL) — for resolve/unresolve. */
  listReviewThreads(repo: RepoPath, prNumber: number): Promise<ReviewThread[]>;
  /** Resolve (`true`) or unresolve (`false`) a review thread by GraphQL node id. */
  resolveReviewThread(threadId: string, resolve: boolean): Promise<void>;
  /** Delete a review comment authored by the bot (respect external deletes). */
  deletePrReviewComment(repo: RepoPath, commentId: number): Promise<void>;
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly method: string,
    readonly url: string,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

// ---- Shared helpers ----

function repoKey(r: RepoPath): string {
  return `${r.owner}/${r.name}`;
}

// ---- HttpGitHubApi ----

export interface HttpGitHubApiOptions {
  appId: string | number;
  privateKeyPem: string;
  /** Optional: a pre-resolved installation id for the bound repo. */
  installationId?: number;
  apiBase?: string;
  /** Injectable fetch (tests/edge). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Real GitHub client backed by the REST + GraphQL APIs. App-installation authed:
 * no PAT, no clone/push. A single installation token (or per-repo resolution via
 * `setInstallationId`) is used for all installs; the cache refreshes with margin.
 */
export class HttpGitHubApi implements GitHubApi {
  private readonly appId: string | number;
  private readonly privateKey: string;
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;
  private readonly tokenCache: InstallationTokenCache;
  private installationId: number | undefined;

  constructor(opts: HttpGitHubApiOptions) {
    this.appId = opts.appId;
    this.privateKey = opts.privateKeyPem;
    this.apiBase = (opts.apiBase ?? "https://api.github.com").replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.tokenCache = new InstallationTokenCache();
    this.installationId = opts.installationId;
  }

  /** Pin the installation id for the bound repo (set after install callback). */
  setInstallationId(id: number): void {
    this.installationId = id;
  }

  private async appJwt(): Promise<string> {
    return mintAppJwt(this.appId, this.privateKey);
  }

  private async installToken(): Promise<string> {
    if (this.installationId === undefined) {
      throw new Error("HttpGitHubApi has no installation id — call setInstallationId first");
    }
    return this.tokenCache.get(this.installationId, async () => {
      const res = await this.fetchImpl(
        `${this.apiBase}/app/installations/${this.installationId}/access_tokens`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${await this.appJwt()}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );
      await this.ensureOk(res, "POST", "access_tokens");
      const json = (await res.json()) as { token: string; expires_at: string };
      return {
        token: json.token,
        expiresAt: Math.floor(new Date(json.expires_at).getTime() / 1000),
      } satisfies InstallationToken;
    });
  }

  private async apiHeaders(): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${await this.installToken()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  private async ensureOk(res: Response, method: string, urlPath: string): Promise<void> {
    if (res.ok) return;
    let body = "";
    try {
      body = await res.text();
    } catch {
      // ignore
    }
    throw new GitHubApiError(
      `GitHub ${method} ${urlPath} -> ${res.status}: ${body.slice(0, 200)}`,
      res.status,
      method,
      urlPath,
    );
  }

  async listInstallationRepos(): Promise<RepoPath[]> {
    const res = await this.fetchImpl(`${this.apiBase}/installation/repositories`, {
      method: "GET",
      headers: await this.apiHeaders(),
    });
    await this.ensureOk(res, "GET", "installation/repositories");
    const json = (await res.json()) as { repositories: Array<{ full_name: string }> };
    return json.repositories.map((r) => {
      const [owner, name] = r.full_name.split("/");
      return { owner: owner!, name: name! };
    });
  }

  async getPullRequest(repo: RepoPath, prNumber: number): Promise<PullRequestInfo> {
    const path = `repos/${repoKey(repo)}/pulls/${prNumber}`;
    const res = await this.fetchImpl(`${this.apiBase}/${path}`, {
      method: "GET",
      headers: await this.apiHeaders(),
    });
    await this.ensureOk(res, "GET", path);
    const json = (await res.json()) as {
      number: number;
      state: "open" | "closed";
      merged: boolean;
      merged_at: string | null;
      head: { sha: string; ref: string };
      title: string;
    };
    return {
      number: json.number,
      state: json.state,
      merged: json.merged,
      mergedAt: json.merged_at,
      head: { sha: json.head.sha, ref: json.head.ref },
      title: json.title,
    };
  }

  async listPrFiles(repo: RepoPath, prNumber: number): Promise<PrFile[]> {
    const out: PrFile[] = [];
    let page = 1;
    for (;;) {
      const path = `repos/${repoKey(repo)}/pulls/${prNumber}/files?page=${page}&per_page=100`;
      const res = await this.fetchImpl(`${this.apiBase}/${path}`, {
        method: "GET",
        headers: await this.apiHeaders(),
      });
      await this.ensureOk(res, "GET", path);
      const json = (await res.json()) as Array<{
        filename: string;
        status: string;
        sha: string;
      }>;
      for (const f of json) {
        out.push({ filename: f.filename, status: f.status, sha: f.sha });
      }
      if (json.length < 100) break;
      page += 1;
      if (page > 20) break; // hard cap; a PR with >2000 files is out of scope
    }
    return out;
  }

  async getFileContent(repo: RepoPath, path: string, ref: string): Promise<Uint8Array> {
    const urlPath = `repos/${repoKey(repo)}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`;
    const res = await this.fetchImpl(`${this.apiBase}/${urlPath}`, {
      method: "GET",
      headers: await this.apiHeaders(),
    });
    await this.ensureOk(res, "GET", urlPath);
    const json = (await res.json()) as { content: string; encoding: string };
    if (json.encoding === "base64") {
      const bin = atob(json.content.replace(/\s/g, ""));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    }
    return new TextEncoder().encode(json.content);
  }

  async listPrReviewComments(
    repo: RepoPath,
    prNumber: number,
    since?: string,
  ): Promise<PrReviewComment[]> {
    const q = since !== undefined ? `?since=${encodeURIComponent(since)}` : "";
    const path = `repos/${repoKey(repo)}/pulls/${prNumber}/comments${q}`;
    const res = await this.fetchImpl(`${this.apiBase}/${path}`, {
      method: "GET",
      headers: await this.apiHeaders(),
    });
    await this.ensureOk(res, "GET", path);
    const json = (await res.json()) as Array<RawPrReviewComment>;
    return json.map(normalizePrReviewComment);
  }

  async getPrReviewComment(repo: RepoPath, commentId: number): Promise<PrReviewComment | null> {
    const path = `repos/${repoKey(repo)}/pulls/comments/${commentId}`;
    const res = await this.fetchImpl(`${this.apiBase}/${path}`, {
      method: "GET",
      headers: await this.apiHeaders(),
    });
    if (res.status === 404) return null;
    await this.ensureOk(res, "GET", path);
    return normalizePrReviewComment((await res.json()) as RawPrReviewComment);
  }

  async createPrReviewComment(
    repo: RepoPath,
    prNumber: number,
    input: CreateReviewCommentInput,
  ): Promise<CreatedComment> {
    const path = `repos/${repoKey(repo)}/pulls/${prNumber}/comments`;
    const body: Record<string, unknown> = {
      body: input.body,
      commit_id: input.commitId,
      path: input.path,
      line: input.line,
      side: input.side,
    };
    if (input.startLine !== undefined) {
      body.start_line = input.startLine;
      body.start_side = input.startSide ?? input.side;
    }
    if (input.inReplyTo !== undefined) body.in_reply_to = input.inReplyTo;
    const res = await this.fetchImpl(`${this.apiBase}/${path}`, {
      method: "POST",
      headers: { ...(await this.apiHeaders()), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    await this.ensureOk(res, "POST", path);
    const json = (await res.json()) as {
      id: number;
      node_id: string;
      url: string;
      pull_request_review_id?: number;
    };
    return { id: json.id, nodeId: json.node_id, url: json.url };
  }

  async createIssueComment(repo: RepoPath, prNumber: number, body: string): Promise<CreatedComment> {
    const path = `repos/${repoKey(repo)}/issues/${prNumber}/comments`;
    const res = await this.fetchImpl(`${this.apiBase}/${path}`, {
      method: "POST",
      headers: { ...(await this.apiHeaders()), "content-type": "application/json" },
      body: JSON.stringify({ body }),
    });
    await this.ensureOk(res, "POST", path);
    const json = (await res.json()) as { id: number; node_id: string; url: string };
    return { id: json.id, nodeId: json.node_id, url: json.url };
  }

  async listReviewThreads(repo: RepoPath, prNumber: number): Promise<ReviewThread[]> {
    // GraphQL: resolve requires the thread node id, which the REST review-comment
    // create response does NOT return. We fetch the threads and match downstream by
    // path/line/comment database id.
    const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{id isResolved comments(first:50){nodes{databaseId path line}}}}}}}`;
    const res = await this.fetchImpl(`${this.apiBase}/graphql`, {
      method: "POST",
      headers: { ...(await this.apiHeaders()), "content-type": "application/json" },
      body: JSON.stringify({ query, variables: { owner: repo.owner, name: repo.name, number: prNumber } }),
    });
    await this.ensureOk(res, "POST", "graphql");
    const json = (await res.json()) as {
      data?: {
        repository?: {
          pullRequest?: {
            reviewThreads?: {
              nodes?: Array<{
                id: string;
                isResolved: boolean;
                comments?: { nodes?: Array<{ databaseId: number; path?: string; line?: number }> };
              }>;
            };
          };
        };
      };
    };
    const nodes = json.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
    return nodes.map((n) => ({
      id: n.id,
      isResolved: n.isResolved,
      comments: (n.comments?.nodes ?? []).map((c) => ({
        databaseId: c.databaseId,
        path: c.path ?? null,
        line: c.line ?? null,
      })),
    }));
  }

  async resolveReviewThread(threadId: string, resolve: boolean): Promise<void> {
    const mutation = resolve
      ? "mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}"
      : "mutation($id:ID!){unresolveReviewThread(input:{threadId:$id}){thread{isResolved}}}";
    const res = await this.fetchImpl(`${this.apiBase}/graphql`, {
      method: "POST",
      headers: { ...(await this.apiHeaders()), "content-type": "application/json" },
      body: JSON.stringify({ query: mutation, variables: { id: threadId } }),
    });
    await this.ensureOk(res, "POST", "graphql:resolveReviewThread");
  }

  async deletePrReviewComment(repo: RepoPath, commentId: number): Promise<void> {
    const path = `repos/${repoKey(repo)}/pulls/comments/${commentId}`;
    const res = await this.fetchImpl(`${this.apiBase}/${path}`, {
      method: "DELETE",
      headers: await this.apiHeaders(),
    });
    if (res.status === 404) return; // already gone — respect the external delete
    await this.ensureOk(res, "DELETE", path);
  }
}

// ---- raw → normalized shapes ----

interface RawPrReviewComment {
  id: number;
  node_id: string;
  url: string;
  path?: string | null;
  line?: number | null;
  side?: "LEFT" | "RIGHT" | null;
  original_line?: number | null;
  original_side?: "LEFT" | "RIGHT" | null;
  in_reply_to_id?: number | null;
  commit_id: string;
  user?: { login?: string; avatar_url?: string } | null;
  body?: string;
  created_at?: string;
  updated_at?: string;
}

function normalizePrReviewComment(c: RawPrReviewComment): PrReviewComment {
  return {
    id: c.id,
    nodeId: c.node_id,
    url: c.url,
    path: c.path ?? null,
    line: c.line ?? null,
    side: c.side ?? null,
    originalLine: c.original_line ?? null,
    originalSide: c.original_side ?? null,
    inReplyToId: c.in_reply_to_id ?? null,
    commitId: c.commit_id,
    user: {
      login: c.user?.login ?? "unknown",
      avatarUrl: c.user?.avatar_url ?? null,
    },
    body: c.body ?? "",
    createdAt: c.created_at ?? "",
    updatedAt: c.updated_at ?? "",
  };
}

// ---- FakeGitHubApi (in-memory, for tests) ----

export interface FakeRepoState {
  pr: PullRequestInfo;
  files: PrFile[];
  /** path → bytes at a given ref (PR head sha). */
  content: Map<string, Uint8Array>;
  reviewComments: PrReviewComment[];
  reviewThreads: ReviewThread[];
  issueComments: Array<{ id: number; nodeId: string; url: string; body: string; authorLogin: string }>;
}

/**
 * In-memory GitHub for tests. Seeded via the `seed*` helpers. Records every mutation
 * so assertions can check outbound state (created review comments, resolved threads,
 * issue comments) and feed inbound dedup (re-list the same comments).
 */
export class FakeGitHubApi implements GitHubApi {
  readonly createdReviewComments: Array<{ repo: RepoPath; pr: number; input: CreateReviewCommentInput; created: CreatedComment }> = [];
  readonly createdIssueComments: Array<{ repo: RepoPath; pr: number; body: string; created: CreatedComment }> = [];
  readonly resolveCalls: Array<{ threadId: string; resolve: boolean }> = [];
  readonly deletedComments: number[] = [];
  private repos = new Map<string, FakeRepoState>();
  private installationRepos: RepoPath[] = [];
  // Randomized base, not 1: integration tests run each FakeGitHubApi instance
  // against a real, persistent (not per-run-ephemeral) Postgres in local dev —
  // a fixed start would let comment ids collide with a previous run's rows
  // under the DB's (provider, external_id) uniqueness constraint.
  private nextId = Math.floor(Math.random() * 1_000_000_000) + 1;
  private lockedLines: Map<string, Set<number>> = new Map();

  /** Seed a PR's files + content for a PR head. */
  seedPr(
    repo: RepoPath,
    pr: number,
    opts: {
      headSha: string;
      branch?: string;
      files: Array<{ filename: string; status: PrFile["status"]; sha: string; content: Uint8Array }>;
      title?: string;
    },
  ): void {
    const content = new Map<string, Uint8Array>();
    const files: PrFile[] = [];
    for (const f of opts.files) {
      files.push({ filename: f.filename, status: f.status, sha: f.sha });
      content.set(`${opts.headSha}:${f.filename}`, f.content);
    }
    const state: FakeRepoState = {
      pr: {
        number: pr,
        state: "open",
        merged: false,
        mergedAt: null,
        head: { sha: opts.headSha, ref: opts.branch ?? "feature" },
        title: opts.title ?? `PR ${pr}`,
      },
      files,
      content,
      reviewComments: [],
      reviewThreads: [],
      issueComments: [],
    };
    this.repos.set(this.repoPrKey(repo, pr), state);
  }

  /** Advance the PR head (a synchronize). Re-seed content at the new sha. */
  advancePrHead(
    repo: RepoPath,
    pr: number,
    opts: { newHeadSha: string; branch?: string; files: Array<{ filename: string; status: PrFile["status"]; sha: string; content: Uint8Array }> },
  ): void {
    const state = this.require(repo, pr);
    state.pr.head = { sha: opts.newHeadSha, ref: opts.branch ?? state.pr.head.ref };
    state.files = opts.files.map((f) => ({ filename: f.filename, status: f.status, sha: f.sha }));
    for (const f of opts.files) {
      state.content.set(`${opts.newHeadSha}:${f.filename}`, f.content);
    }
  }

  markPrMerged(repo: RepoPath, pr: number): void {
    const s = this.require(repo, pr);
    s.pr.state = "closed";
    s.pr.merged = true;
    s.pr.mergedAt = new Date().toISOString();
  }

  markPrClosed(repo: RepoPath, pr: number): void {
    const s = this.require(repo, pr);
    s.pr.state = "closed";
  }

  /** Seed an existing review comment from native GitHub (inbound import). */
  seedReviewComment(repo: RepoPath, pr: number, c: Partial<PrReviewComment> & Pick<PrReviewComment, "id" | "path" | "line" | "body" | "commitId" | "nodeId" | "url">): void {
    const state = this.require(repo, pr);
    const full: PrReviewComment = {
      id: c.id,
      nodeId: c.nodeId,
      url: c.url,
      path: c.path,
      line: c.line,
      side: c.side ?? "RIGHT",
      originalLine: c.originalLine ?? c.line,
      originalSide: c.originalSide ?? c.side ?? "RIGHT",
      inReplyToId: c.inReplyToId ?? null,
      commitId: c.commitId,
      user: c.user ?? { login: "octocat", avatarUrl: null },
      body: c.body,
      createdAt: c.createdAt ?? new Date().toISOString(),
      updatedAt: c.updatedAt ?? new Date().toISOString(),
    };
    state.reviewComments.push(full);
  }

  /** Declare which diff lines are valid for review comments (out-of-diff reject). */
  setDiffLines(repo: RepoPath, path: string, lines: Set<number>): void {
    this.lockedLines.set(`${repoKey(repo)}:${path}`, lines);
  }

  setInstallationRepos(repos: RepoPath[]): void {
    this.installationRepos = repos;
  }

  /** Seed a review thread (e.g. resolved natively on GitHub, not via `createPrReviewComment`). */
  seedReviewThread(
    repo: RepoPath,
    pr: number,
    thread: { id: string; isResolved: boolean; comments: Array<{ databaseId: number; path?: string | null; line?: number | null }> },
  ): void {
    const state = this.require(repo, pr);
    state.reviewThreads.push({
      id: thread.id,
      isResolved: thread.isResolved,
      comments: thread.comments.map((c) => ({
        databaseId: c.databaseId,
        path: c.path ?? null,
        line: c.line ?? null,
      })),
    });
  }

  private repoPrKey(repo: RepoPath, pr: number): string {
    return `${repoKey(repo)}#${pr}`;
  }
  private require(repo: RepoPath, pr: number): FakeRepoState {
    const s = this.repos.get(this.repoPrKey(repo, pr));
    if (!s) throw new Error(`FakeGitHubApi: no PR seeded for ${this.repoPrKey(repo, pr)}`);
    return s;
  }
  private freshId(): number {
    return this.nextId++;
  }

  async listInstallationRepos(): Promise<RepoPath[]> {
    return [...this.installationRepos];
  }

  async getPullRequest(repo: RepoPath, prNumber: number): Promise<PullRequestInfo> {
    return this.require(repo, prNumber).pr;
  }

  async listPrFiles(repo: RepoPath, prNumber: number): Promise<PrFile[]> {
    return [...this.require(repo, prNumber).files];
  }

  async getFileContent(repo: RepoPath, path: string, ref: string): Promise<Uint8Array> {
    // The provider always fetches at the PR head sha (`ref`). Content is seeded
    // keyed by `${headSha}:${filename}`, so find the matching repo state by head.
    void repo;
    for (const state of this.repos.values()) {
      const bytes = state.content.get(`${ref}:${path}`);
      if (bytes) return bytes;
    }
    throw new Error(`FakeGitHubApi: no content for ${ref}:${path}`);
  }

  async listPrReviewComments(repo: RepoPath, prNumber: number, since?: string): Promise<PrReviewComment[]> {
    const state = this.require(repo, prNumber);
    void since;
    return [...state.reviewComments];
  }

  async getPrReviewComment(repo: RepoPath, commentId: number): Promise<PrReviewComment | null> {
    for (const state of this.repos.values()) {
      const c = state.reviewComments.find((x) => x.id === commentId);
      if (c) return c;
    }
    void repo;
    return null;
  }

  async createPrReviewComment(repo: RepoPath, prNumber: number, input: CreateReviewCommentInput): Promise<CreatedComment> {
    const state = this.require(repo, prNumber);
    // Out-of-diff rejection (mirror the real API's 422).
    const allowed = this.lockedLines.get(`${repoKey(repo)}:${input.path}`);
    if (allowed && !allowed.has(input.line)) {
      throw new GitHubApiError("out-of-diff line rejected", 422, "POST", "pulls/comments");
    }
    const id = this.freshId();
    const nodeId = `PRRC_${id}`;
    const url = `https://github.com/${repoKey(repo)}/pull/${prNumber}#discussion_r${id}`;
    const created: CreatedComment = { id, nodeId, url, threadNodeId: nodeId };
    this.createdReviewComments.push({ repo, pr: prNumber, input, created });
    // Record into the seeded state so the inbound dedup can see it.
    state.reviewComments.push({
      id,
      nodeId,
      url,
      path: input.path,
      line: input.line,
      side: input.side,
      originalLine: input.line,
      originalSide: input.side,
      inReplyToId: input.inReplyTo ?? null,
      commitId: input.commitId,
      user: { login: "scholia-bot[bot]", avatarUrl: null },
      body: input.body,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    state.reviewThreads.push({
      id: nodeId,
      isResolved: false,
      comments: [{ databaseId: id, path: input.path, line: input.line }],
    });
    return created;
  }

  async createIssueComment(repo: RepoPath, prNumber: number, body: string): Promise<CreatedComment> {
    const state = this.require(repo, prNumber);
    const id = this.freshId();
    const nodeId = `IC_${id}`;
    const url = `https://github.com/${repoKey(repo)}/issues/${prNumber}#issuecomment-${id}`;
    const created: CreatedComment = { id, nodeId, url };
    this.createdIssueComments.push({ repo, pr: prNumber, body, created });
    state.issueComments.push({ id, nodeId, url, body, authorLogin: "scholia-bot[bot]" } );
    return created;
  }

  async listReviewThreads(repo: RepoPath, prNumber: number): Promise<ReviewThread[]> {
    return [...this.require(repo, prNumber).reviewThreads];
  }

  async resolveReviewThread(threadId: string, resolve: boolean): Promise<void> {
    this.resolveCalls.push({ threadId, resolve });
    for (const state of this.repos.values()) {
      const t = state.reviewThreads.find((x) => x.id === threadId);
      if (t) t.isResolved = resolve;
    }
  }

  async deletePrReviewComment(repo: RepoPath, commentId: number): Promise<void> {
    void repo;
    this.deletedComments.push(commentId);
    for (const state of this.repos.values()) {
      const idx = state.reviewComments.findIndex((x) => x.id === commentId);
      if (idx >= 0) state.reviewComments.splice(idx, 1);
    }
  }
}
// Content-source byte fetch (ADR-0009): read PR files or ref bytes at a head
// commit — no clone, no push. Only `.md`/`.html` files become Pages; everything
// else is dropped (PR-backed Sites scope to changed md/html only). Provenance is
// clean (pinned ref/PR head), so there is no dirty-tree problem.

import type { FetchResult, FetchedFile } from "@scholia/core";
import { type GitHubApi, type PrFile, type PullRequestInfo, type RepoPath } from "./rest.js";

export function parseRepo(s: string): RepoPath {
  const parts = s.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`invalid repo "${s}" — expected owner/name`);
  }
  return { owner: parts[0]!, name: parts[1]! };
}

function isDocPath(path: string): boolean {
  return /\.(md|html)$/i.test(path);
}

// Fetch the PR's changed .md/.html files at the PR head. Returns the raw bytes +
// a clean Provenance ({remote, sha, branch, dirty:false}). Files removed in the
// PR are skipped (no Page at that path).
export async function fetchPRFiles(
  api: GitHubApi,
  repoStr: string,
  prNumber: number,
): Promise<FetchResult> {
  const repo = parseRepo(repoStr);
  const pr: PullRequestInfo = await api.getPullRequest(repo, prNumber);
  const files: PrFile[] = await api.listPrFiles(repo, prNumber);
  const out: FetchedFile[] = [];
  for (const f of files) {
    if (f.status === "removed") continue;
    if (!isDocPath(f.filename)) continue;
    const bytes = await api.getFileContent(repo, f.filename, pr.head.sha);
    out.push({ path: f.filename, bytes });
  }
  return {
    files: out,
    provenance: {
      remote: `https://github.com/${repo.owner}/${repo.name}`,
      sha: pr.head.sha,
      branch: pr.head.ref,
      dirty: false,
    },
  };
}

// Ref sources (branch/tag/commit) enumerate the tree via the Git Data API.
// `HttpGitHubApi` exposes this through `listTree`; the FakeGitHubApi seeds paths
// ahead of time. Ref sources are NOT mirrored (ADR-0008 mirroring is PR-only) but
// still produce a clean-Provenance Version.
export async function fetchRefFiles(
  api: GitHubApi,
  repoStr: string,
  ref: string,
  opts: { listTree?: (api: GitHubApi, repo: RepoPath, ref: string) => Promise<string[]> } = {},
): Promise<FetchResult> {
  const repo = parseRepo(repoStr);
  const listTree = opts.listTree ?? defaultListTree;
  const paths = await listTree(api, repo, ref);
  const out: FetchedFile[] = [];
  for (const path of paths) {
    if (!isDocPath(path)) continue;
    const bytes = await api.getFileContent(repo, path, ref);
    out.push({ path, bytes });
  }
  return {
    files: out,
    provenance: {
      remote: `https://github.com/${repo.owner}/${repo.name}`,
      sha: ref,
      branch: ref,
      dirty: false,
    },
  };
}

// Default tree listing: the HttpGitHubApi doesn't expose git/trees directly in
// this package's interface, so the real impl is supplied by the provider (see
// GitHubMirrorProvider#fetchContent, which uses the REST client's tree fetch).
// Tests / provider override `listTree` with a seeded path list.
async function defaultListTree(_api: GitHubApi, _repo: RepoPath, _ref: string): Promise<string[]> {
  throw new Error("fetchRefFiles: caller must supply a listTree helper");
}
import { describe, test, expect } from "vitest";
import { mintAppJwt, decodeJwtPayload } from "../src/auth.js";
import {
  FakeGitHubApi,
  GitHubApiError,
  HttpGitHubApi,
  fetchPRFiles,
  parseRepo,
  type RepoPath,
} from "../src/index.js";

// A throwaway RSA keypair generated at runtime for JWT signing tests (avoids
// shipping a fixture PEM). Generated with node `crypto.generateKeyPairSync`.
function generatePrivateKeyPem(): string {
  const { generateKeyPairSync } = require("node:crypto") as typeof import("node:crypto");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

describe("auth: mintAppJwt", () => {
  test("produces a 3-part RS256 JWT with iss = appId", () => {
    const pem = generatePrivateKeyPem();
    const jwt = mintAppJwt("123456", pem);
    expect(typeof jwt).toBe("string");
    const parts = jwt.split(".");
    expect(parts.length).toBe(3);

    const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString()) as {
      alg: string;
      typ: string;
    };
    expect(header.alg).toBe("RS256");
    expect(header.typ).toBe("JWT");

    const payload = decodeJwtPayload(jwt)!;
    expect(payload.iss).toBe("123456");
    expect(typeof payload.iat).toBe("number");
    expect(typeof payload.exp).toBe("number");
    expect((payload.exp as number) - (payload.iat as number)).toBeGreaterThanOrEqual(8 * 60);
  });
});

describe("fetchPRFiles", () => {
  test("returns only changed .md/.html files at the PR head with clean provenance", async () => {
    const api = new FakeGitHubApi();
    const repo: RepoPath = { owner: "owner", name: "repo" };
    const md = new TextEncoder().encode("# Hello\n");
    const css = new TextEncoder().encode("body {}\n");
    api.seedPr(repo, 7, {
      headSha: "abc123",
      branch: "feature",
      files: [
        { filename: "doc.md", status: "added", sha: "h-md", content: md },
        { filename: "style.css", status: "added", sha: "h-css", content: css },
        { filename: "gone.md", status: "removed", sha: "h-gone", content: md },
      ],
    });

    const result = await fetchPRFiles(api, "owner/repo", 7);
    expect(result.files.map((f) => f.path)).toEqual(["doc.md"]);
    expect(result.provenance).toEqual({
      remote: "https://github.com/owner/repo",
      sha: "abc123",
      branch: "feature",
      dirty: false,
    });
  });
});

describe("FakeGitHubApi outbound", () => {
  test("createPrReviewComment records + rejects out-of-diff lines", async () => {
    const api = new FakeGitHubApi();
    const repo: RepoPath = { owner: "owner", name: "repo" };
    api.seedPr(repo, 1, { headSha: "sha1", files: [] });
    api.setDiffLines(repo, "doc.md", new Set([5, 6]));

    const ok = await api.createPrReviewComment(repo, 1, {
      body: "hi",
      commitId: "sha1",
      path: "doc.md",
      line: 5,
      side: "RIGHT",
    });
    expect(typeof ok.id).toBe("number");
    expect(api.createdReviewComments).toHaveLength(1);

    await expect(
      api.createPrReviewComment(repo, 1, {
        body: "hi",
        commitId: "sha1",
        path: "doc.md",
        line: 999,
        side: "RIGHT",
      }),
    ).rejects.toBeInstanceOf(GitHubApiError);
  });

  test("review comments + issue comments recorded, resolve tracked", async () => {
    const api = new FakeGitHubApi();
    const repo: RepoPath = { owner: "owner", name: "repo" };
    api.seedPr(repo, 2, { headSha: "sha1", files: [] });
    await api.createIssueComment(repo, 2, "note");
    expect(api.createdIssueComments[0]!.body).toBe("note");
    await api.resolveReviewThread("PRRC_1", true);
    expect(api.resolveCalls).toEqual([{ threadId: "PRRC_1", resolve: true }]);
  });
});

describe("parseRepo", () => {
  test("splits owner/name", () => {
    expect(parseRepo("owner/repo")).toEqual({ owner: "owner", name: "repo" });
  });
  test("rejects malformed", () => {
    expect(() => parseRepo("nope")).toThrow();
  });
});

describe("HttpGitHubApi construction", () => {
  test("constructs without throwing when given a key", () => {
    const pem = generatePrivateKeyPem();
    const api = new HttpGitHubApi({ appId: "1", privateKeyPem: pem, installationId: 99 });
    expect((api as unknown as { installationId: number }).installationId).toBe(99);
  });
});

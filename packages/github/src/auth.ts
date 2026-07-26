// GitHub App authentication (ADR-0009). RS256 JWT minted with the App's private
// key; installation access tokens exchanged and cached with a refresh margin.
// Both are read-only / PR-comment scope only — no clone, no push, no stored PAT.
//
// Pure node `crypto` + global `fetch`; no `@octokit/*` dependency to keep the
// footprint small and the surface easy to fake in tests.

import { createSign } from "node:crypto";

export function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

// Mint a short-lived GitHub App JWT (RS256). `iss` = App id; `iat` skewed back 60s
// to absorb clock drift; `exp` 9 minutes out (GitHub caps at 10). Exported so tests
// can assert the header/payload shape without a live key.
export function mintAppJwt(appId: number | string, privateKeyPem: string): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: String(appId) }),
  );
  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKeyPem);
  return `${signingInput}.${signature.toString("base64url")}`;
}

// Decode a JWT payload (no verification — only for inspecting our own freshly-minted
// tokens in tests). Returns null on malformed input.
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    return JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

export interface InstallationToken {
  token: string;
  /** UNIX seconds when the token expires; GitHub's installation tokens last ~1h. */
  expiresAt: number;
}

// In-memory installation-token cache with a refresh margin. Guards a per-installation
// lock so a thundering herd of mirror operations reuses one token. `fetchToken` is
// injected so `HttpGitHubApi` supplies the real exchange and `FakeGitHubApi`-backed
// tests can substitute a stub.
export class InstallationTokenCache {
  private cache = new Map<number, InstallationToken>();
  private refreshing = new Map<number, Promise<InstallationToken>>();
  private readonly refreshMarginMs: number;
  private readonly now: () => number;

  constructor(opts: { refreshMarginMs?: number; now?: () => number } = {}) {
    this.refreshMarginMs = opts.refreshMarginMs ?? 5 * 60 * 1000;
    this.now = opts.now ?? (() => Date.now());
  }

  async get(installationId: number, fetchToken: () => Promise<InstallationToken>): Promise<string> {
    const cached = this.cache.get(installationId);
    const nowMs = this.now();
    if (cached && cached.expiresAt * 1000 - nowMs > this.refreshMarginMs) {
      return cached.token;
    }
    let pending = this.refreshing.get(installationId);
    if (!pending) {
      pending = fetchToken().finally(() => this.refreshing.delete(installationId));
      this.refreshing.set(installationId, pending);
    }
    const token = await pending;
    this.cache.set(installationId, token);
    return token.token;
  }

  /** Test hook: invalidate the cached token. */
  invalidate(installationId: number): void {
    this.cache.delete(installationId);
  }
}

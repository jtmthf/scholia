// Operator GitHub config (ADR-0009, M10). All `GITHUB_*` env vars are optional —
// when the App id + private key aren't set, GitHub integration is off and the
// no-config promise for ordinary (local/non-PR) Sites is untouched. The provider
// is constructed eagerly so a misconfiguration fails on boot, not mid-request.

import { readFileSync } from "node:fs";
import { HttpGitHubApi } from "@collab/github";
import type { MirrorProvider } from "@collab/core";
import { GitHubMirrorProvider } from "./mirror/github-provider.js";

export interface GitHubOperatorConfig {
  appId: string;
  appSlug: string;
  /** The private key PEM, from env or `GITHUB_APP_PRIVATE_KEY_PATH`. */
  privateKeyPem: string;
  webhookSecret: string;
  apiBase: string;
  reconcileIntervalMs: number;
}

export function githubConfigFromEnv(): GitHubOperatorConfig | null {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const slug = process.env.GITHUB_APP_SLUG?.trim() ?? "collab";
  const key =
    process.env.GITHUB_APP_PRIVATE_KEY?.trim() ||
    (process.env.GITHUB_APP_PRIVATE_KEY_PATH
      ? readFileSync(process.env.GITHUB_APP_PRIVATE_KEY_PATH, "utf8").trim()
      : "");
  if (!appId || !key) return null;
  return {
    appId,
    appSlug: slug,
    privateKeyPem: key,
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? "",
    apiBase: (process.env.GITHUB_API_BASE ?? "https://api.github.com").replace(/\/+$/, ""),
    reconcileIntervalMs: Number(process.env.GITHUB_RECONCILE_INTERVAL_MS ?? 60_000),
  };
}

// GitHub Apps post as `<app-slug>[bot]` (GitHub's own convention). Used to
// recognize and skip the bot's own comments on the inbound path.
export function botLoginFor(config: GitHubOperatorConfig): string {
  return `${config.appSlug}[bot]`;
}

// Construct the @collab/github provider (installation id resolved lazily per repo
// via `findInstallationForRepo`). The bus + a `MirrorContext` builder are wired by
// the caller; the provider only needs the API client + db.
export function loadMirrorProviders(opts: {
  github: GitHubOperatorConfig | null;
  deps: { db: unknown };
}): MirrorProvider[] {
  if (!opts.github) return [];
  const api = new HttpGitHubApi({
    appId: opts.github.appId,
    privateKeyPem: opts.github.privateKeyPem,
    apiBase: opts.github.apiBase,
  });
  // The provider owns installation resolution (db lookup) + dispatch + reconcile.
  return [new GitHubMirrorProvider({ api, db: opts.deps.db as never, config: opts.github })];
}
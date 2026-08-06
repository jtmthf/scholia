// Which application the verbs run against (ADR-0020).
//
// Local is the default, and that is the whole point: `scholia comment` works in
// a repository where Scholia has never been started, with no server, no port
// and no token. An agent can leave a Comment from a git hook or from CI, and
// nobody has to have a preview open for it to land.
//
// Naming a server switches to the hosted target, and nothing else about the
// command changes — same flags, same output, same verbs. The surfaces never
// learn which one they got.

import { loadCredentials, ScholiaClient, createRemoteApi } from "@scholia/client";
import { createLocalApi } from "@scholia/sidecar";
import type { ConversationApi } from "@scholia/core";

/** The flags every verb command carries, on top of its own params. */
export interface TargetOptions {
  /** Project root for the local Sidecar. Ignored when a server is named. */
  root?: string;
  /** Hosted Site base URL. Its presence is what selects the remote target. */
  server?: string;
  site?: string;
  token?: string;
  /** The acting Viewer, for hosted verbs the server checks ownership on. */
  viewer?: string;
}

/** Whether these options (plus the environment) name a hosted Site. */
export function isRemote(options: TargetOptions): boolean {
  return Boolean(options.server ?? process.env.SCHOLIA_SERVER);
}

/**
 * The application the verbs will run against.
 *
 * The remote branch resolves its Site the same way `share` does — an explicit
 * `--site`, else the newest stored credential — so an agent that ran `scholia
 * share` once needs no flags afterwards.
 */
export async function resolveTarget(options: TargetOptions): Promise<ConversationApi> {
  if (!isRemote(options)) {
    return createLocalApi(options.root === undefined ? {} : { rootDir: options.root });
  }

  const server = (options.server ?? process.env.SCHOLIA_SERVER ?? "").replace(/\/+$/, "");
  const store = await loadCredentials();
  const entries = Object.values(store);
  const cred = options.site
    ? entries.find((entry) => entry.slug === options.site)
    : entries.length
      ? entries.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
      : undefined;

  const slug = options.site ?? cred?.slug ?? process.env.SCHOLIA_SITE;
  const token = options.token ?? process.env.SCHOLIA_TOKEN ?? cred?.token;
  if (!slug) {
    throw new Error("no site — pass --site <slug>, set SCHOLIA_SITE, or run `scholia share` first");
  }
  if (!token) {
    throw new Error("no token — pass --token, set SCHOLIA_TOKEN, or run `scholia share` first");
  }

  const viewer = options.viewer ?? process.env.SCHOLIA_VIEWER;
  return createRemoteApi(
    new ScholiaClient({ server, token, slug }),
    viewer === undefined ? {} : { viewerId: viewer },
  );
}

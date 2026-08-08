#!/usr/bin/env node
import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { cac, type CAC } from "cac";
import open from "open";
import { startServer } from "@scholia/local";
import {
  ScholiaClient,
  loadCredentials,
  removeCredential,
  saveCredential,
  type SiteCredential,
} from "@scholia/client";
import { share } from "./share.js";
import { resolveEditorPreference } from "./editor-preference.js";
import { sidecarCommit, sidecarUncommit } from "./sidecar-cli.js";
import { registerVerbCommands } from "./verb-cli.js";
import { serveMcp } from "./mcp.js";

const cli = cac("scholia");

// `../package.json` resolves the same from both entry points: src/cli.ts during
// `pnpm start` (tsx) and dist/cli.js in the published package, since npm always
// includes package.json in the tarball. Going through createRequire explicitly
// rather than a bare `require()` keeps esbuild from inlining the whole manifest
// and keeps it working under tsx, where no `require` global exists.
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

// Hosted commands (share/chats/state/rotate-*/delete-site) talk to @scholia/server,
// which is out of scope for the v0.1 Local Preview release. They stay in the source
// but are only registered when SCHOLIA_HOSTED=1, so `--help` and the binary surface
// nothing that depends on a server this release doesn't ship. Flip the env var to
// bring them back for local hosted-path development.
const HOSTED_ENABLED = process.env.SCHOLIA_HOSTED === "1";

// cac hands action handlers a bare options bag. These describe what each command
// actually declares via `.option()`, so a renamed flag is a type error at the
// handler rather than an `undefined` at runtime.
interface OwnerOptions {
  server: string;
  site?: string;
  token?: string;
}

interface ShareOptions {
  server: string;
  site?: string;
  new?: boolean;
  pr?: string;
  ref?: string;
}

interface DeleteSiteOptions extends OwnerOptions {
  yes?: boolean;
}

/**
 * `scholia mcp` flags. `--http` is cac's optional-value shape: absent is
 * `false`, bare `--http` is `true` (take the default port), `--http 9000` is
 * the string.
 */
interface McpCliOptions {
  http?: boolean | string;
  root?: string;
  server?: string;
  site?: string;
  token?: string;
  viewer?: string;
}

/** Where `scholia mcp --http` listens when no port is given. */
const DEFAULT_MCP_PORT = 8888;

interface PreviewOptions {
  port?: string | number;
  host: string;
  open: boolean;
  mdx: boolean;
  editor?: string;
}

// Resolve the owner credential for an ops command the same way `share`/`chats` do:
// an explicit --site, else the newest stored credential; token from --token,
// SCHOLIA_TOKEN, or the stored credential. Owner ops need the OWNER token.
async function resolveOwner(
  options: OwnerOptions,
): Promise<{ server: string; slug: string; token: string; cred?: SiteCredential }> {
  const server = options.server.replace(/\/+$/, "");
  const store = await loadCredentials();
  const entries = Object.values(store);
  const cred = options.site
    ? entries.find((e) => e.slug === options.site)
    : entries.length
      ? entries.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
      : undefined;

  const slug = options.site ?? cred?.slug ?? process.env.SCHOLIA_SITE;
  const token = options.token ?? process.env.SCHOLIA_TOKEN ?? cred?.token;
  if (!slug) throw new Error("no site — pass --site <slug> or run `scholia share` first");
  if (!token)
    throw new Error(
      "no owner token — pass --token, set SCHOLIA_TOKEN, or run `scholia share` first",
    );
  return { server, slug, token, cred };
}

// Registers every server-backed command. Gated behind SCHOLIA_HOSTED so the default
// v0.1 build exposes Local Preview only.
function registerHostedCommands(cli: CAC): void {
  // Share (ADR-0010): `scholia share <path>` promotes local content to a hosted,
  // public Site — the explicit step out of local-first Preview. M3 accepts a
  // single file, a directory (walked recursively), or a .zip archive.
  // M10 adds `--pr owner/repo#123` and `--ref owner/repo@<ref>` to create a Site
  // from a GitHub content source (the server fetches bytes; no local path needed).
  cli
    .command("share [path]", "Upload a file, folder, or zip and host it as a public Site")
    .option("--server <url>", "Scholia server base URL", {
      default: process.env.SCHOLIA_SERVER ?? "http://localhost:8787",
    })
    .option("--new", "Create a fresh Site even if a .scholia marker exists")
    .option("--site <slug>", "Re-upload a new Version to this specific Site slug")
    .option("--pr <spec>", "Create from a GitHub PR: owner/repo#123")
    .option("--ref <spec>", "Create from a GitHub ref: owner/repo@<ref>")
    .action(async (path: string | undefined, options: ShareOptions) => {
      try {
        await share(path, {
          server: options.server,
          forceNew: options.new,
          site: options.site,
          pr: options.pr,
          ref: options.ref,
        });
      } catch (err) {
        console.error(`[scholia] ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // `scholia chats` is not here: it is a verb now (ADR-0021), registered
  // unconditionally below and pointed at a hosted Site with `--server`. One
  // command listing Chats, whichever application holds them.

  // ---- M9: Owner moderation & ops ----

  const OPS_DEFAULT_SERVER = { default: process.env.SCHOLIA_SERVER ?? "http://localhost:8787" };

  // `scholia state <state>` — set the Site moderation posture (open|read_only|frozen).
  cli
    .command("state <state>", "Set the Site state: open | read_only | frozen")
    .option("--server <url>", "Scholia server base URL", OPS_DEFAULT_SERVER)
    .option("--site <slug>", "Site slug (defaults to the newest stored credential)")
    .option("--token <token>", "Owner token (defaults to SCHOLIA_TOKEN or the stored credential)")
    .action(async (state: string, options: OwnerOptions) => {
      try {
        if (!["open", "read_only", "frozen"].includes(state)) {
          throw new Error(`invalid state "${state}" — expected open, read_only, or frozen`);
        }
        const { server, slug, token } = await resolveOwner(options);
        const client = new ScholiaClient({ server, token, slug });
        const res = await client.setState(state as "open" | "read_only" | "frozen");
        console.log(`[scholia] ${slug} is now ${res.state}`);
      } catch (err) {
        console.error(`[scholia] ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // `scholia rotate-share` — mint a fresh Share URL (invalidates the old link).
  cli
    .command("rotate-share", "Rotate the Share URL (kills a leaked link)")
    .option("--server <url>", "Scholia server base URL", OPS_DEFAULT_SERVER)
    .option("--site <slug>", "Site slug (defaults to the newest stored credential)")
    .option("--token <token>", "Owner token (defaults to SCHOLIA_TOKEN or the stored credential)")
    .action(async (options: OwnerOptions) => {
      try {
        const { server, slug, token, cred } = await resolveOwner(options);
        const client = new ScholiaClient({ server, token, slug });
        const res = await client.rotateShare();
        // Re-key the stored credential under the new slug; the token is unchanged.
        if (cred) {
          await removeCredential(slug);
          await saveCredential({ ...cred, slug: res.slug, shareUrl: res.shareUrl });
        }
        console.log(`[scholia] new Share URL: ${res.shareUrl}`);
        console.log(`[scholia] the old link no longer resolves.`);
      } catch (err) {
        console.error(`[scholia] ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // `scholia rotate-token` — mint a fresh owner token (revokes the old ones).
  cli
    .command("rotate-token", "Rotate the owner token / Agent URL (revokes the old token)")
    .option("--server <url>", "Scholia server base URL", OPS_DEFAULT_SERVER)
    .option("--site <slug>", "Site slug (defaults to the newest stored credential)")
    .option("--token <token>", "Owner token (defaults to SCHOLIA_TOKEN or the stored credential)")
    .action(async (options: OwnerOptions) => {
      try {
        const { server, slug, token, cred } = await resolveOwner(options);
        const client = new ScholiaClient({ server, token, slug });
        const res = await client.rotateToken();
        if (cred) await saveCredential({ ...cred, token: res.token });
        console.log(`[scholia] new owner token: ${res.token}`);
        console.log(`[scholia] new Agent URL:  ${res.agentUrl}`);
        console.log(`[scholia] the previous owner token / Agent URL is now revoked.`);
      } catch (err) {
        console.error(`[scholia] ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // `scholia delete-site` — permanently delete the Site. Requires --yes (no prompt).
  cli
    .command("delete-site", "Permanently delete the Site and all its data")
    .option("--server <url>", "Scholia server base URL", OPS_DEFAULT_SERVER)
    .option("--site <slug>", "Site slug (defaults to the newest stored credential)")
    .option("--token <token>", "Owner token (defaults to SCHOLIA_TOKEN or the stored credential)")
    .option("--yes", "Confirm the deletion (required — this is irreversible)")
    .action(async (options: DeleteSiteOptions) => {
      try {
        const { server, slug, token } = await resolveOwner(options);
        if (!options.yes) {
          throw new Error(
            `this permanently deletes Site "${slug}" and every Version/comment. Re-run with --yes to confirm.`,
          );
        }
        const client = new ScholiaClient({ server, token, slug });
        await client.deleteSite();
        await removeCredential(slug);
        console.log(`[scholia] deleted Site ${slug}.`);
      } catch (err) {
        console.error(`[scholia] ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}

if (HOSTED_ENABLED) registerHostedCommands(cli);

// The Conversation verb set (ADR-0018, ADR-0019, ADR-0021, ADR-0032): comment,
// reply, react, resolve, reopen, edit, delete, promote, and the two listings.
//
// Every one of them is rendered from the application layer's registry, which
// `scholia mcp` renders too — so a verb exists on both surfaces or on neither.
// They default to the Sidecar in the tree you are standing in: no server, no
// token, no network. `--server` points the same command at a hosted Site.
registerVerbCommands(cli);

// MCP as a subcommand rather than a second package (ADR-0021): the CLI is
// already the install. stdio by default, streamable HTTP for the clients that
// cannot spawn a process.
cli
  .command("mcp", "Serve the same verbs over MCP (stdio, or --http for streamable HTTP)")
  .option("--http [port]", "Serve streamable HTTP on this port instead of stdio", {
    default: false,
  })
  .option("--root <dir>", "Project root directory (default: cwd)")
  .option("--server <url>", "Serve a hosted Site rather than the local Sidecar")
  .option("--site <slug>", "Hosted Site slug (defaults to the newest stored credential)")
  .option("--token <token>", "Hosted Site token (defaults to SCHOLIA_TOKEN or the credential)")
  .option("--viewer <id>", "Acting Viewer id, for hosted verbs that check ownership")
  .action(async (options: McpCliOptions) => {
    try {
      const http =
        options.http === false || options.http === undefined
          ? undefined
          : Number(options.http === true ? DEFAULT_MCP_PORT : options.http);
      if (http !== undefined && !Number.isInteger(http)) {
        throw new Error(`invalid --http ${String(options.http)} — expected a port number`);
      }
      await serveMcp(
        {
          ...(http === undefined ? {} : { http }),
          root: options.root,
          server: options.server,
          site: options.site,
          token: options.token,
          viewer: options.viewer,
        },
        version,
      );
    } catch (err) {
      // stdout belongs to the protocol, so a startup failure goes to stderr.
      process.stderr.write(`[scholia] ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });

// The team workflow, in one command (ADR-0018). Conversations are untracked by
// default — a repository shared with people who have never heard of Scholia
// carries no trace of it — and this is the deliberate choice to commit them, so
// they travel with the content and git becomes the review channel.
cli
  .command("commit-sidecar", "Commit this repository's Threads, so they travel with the content")
  .option("--undo", "Put the Sidecar back to untracked")
  .option("--root <dir>", "Project root directory (default: cwd)")
  .action(async (options: { undo?: boolean; root?: string }) => {
    try {
      await (options.undo ? sidecarUncommit : sidecarCommit)({ root: options.root });
    } catch (err) {
      console.error(`[scholia] ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// Local Preview (ADR-0010): `scholia <path>` renders a local file or folder in
// the browser — no account, no token, no network. The default entry point.
const DEFAULT_PORT = 3000;

cli
  .command("[target]", "Preview a local markdown file or directory")
  .option(
    "-p, --port <port>",
    `Port to listen on (default: ${DEFAULT_PORT}; errors if an explicit port is taken)`,
  )
  .option("--host <host>", "Host to bind", { default: "localhost" })
  .option("--no-open", "Do not open the browser automatically")
  .option("--no-mdx", "Disable MDX rendering (.mdx served as plain markdown)")
  .option("--editor <command>", "Editor to open files in, e.g. cursor (saved to ~/.scholia/config)")
  .action(async (target: string | undefined, options: PreviewOptions) => {
    const input = resolve(target ?? ".");

    const info = await stat(input).catch(() => null);
    if (!info) {
      console.error(`[scholia] not found: ${input}`);
      process.exit(1);
    }

    const isFile = info.isFile();
    const rootDir = isFile ? dirname(input) : input;

    // An explicit --port is a hard request: if it's taken, fail loudly rather
    // than silently binding a different port. Without --port we fall back from
    // the default to the next open port (and say so), matching common
    // dev-server DX (Vite/Next).
    const explicitPort = options.port !== undefined;
    const requestedPort = explicitPort ? Number(options.port) : DEFAULT_PORT;
    if (explicitPort && !Number.isInteger(requestedPort)) {
      console.error(`[scholia] invalid --port ${options.port} — expected an integer`);
      process.exit(1);
    }

    let editorOverride: string | undefined;
    try {
      editorOverride = await resolveEditorPreference(options.editor);
    } catch (err) {
      console.error(`[scholia] ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    let server: Awaited<ReturnType<typeof startServer>>;
    try {
      server = await startServer({
        rootDir,
        singleFile: isFile ? input : undefined,
        port: requestedPort,
        host: options.host,
        mdxEnabled: options.mdx !== false,
        open: options.open !== false,
        strictPort: explicitPort,
        editorOverride,
      });
    } catch (err) {
      console.error(`[scholia] ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    if (!explicitPort && server.port !== DEFAULT_PORT) {
      console.log(`\n  [scholia] port ${DEFAULT_PORT} is in use — falling back to ${server.port}`);
    }

    console.log(`\n  scholia preview — ${isFile ? "file" : "directory"}: ${input}`);
    console.log(`  ➜  ${server.url}`);
    // What this preview can do, in this preview's own words (issue #35) — the
    // address to hand an agent, so it reads the docs rather than guessing.
    console.log(`  agent docs: ${server.url}/__agent-docs\n`);

    if (options.open !== false) {
      await open(server.url).catch(() => {
        console.log("  (could not open browser automatically)");
      });
    }

    const shutdown = async () => {
      await server.close();
      process.exit(0);
    };
    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());
  });

// The two things a first-time user most needs from `--help` and won't find in the
// flag list: that .mdx is executed rather than parsed (ADR-0012's trust boundary,
// stated where it's actually load-bearing — the CLI is the trusted surface), and
// that this release is Local Preview only, so nobody files bugs against `share`.
cli.help((sections) => {
  sections.push({
    title: "Notes",
    body: [
      "  MDX runs as code on your machine — only preview files you trust.",
      "  Pass --no-mdx to render .mdx as plain markdown, with no evaluation.",
      "",
      "  This release is Local Preview only: no account, token, or network.",
      "  Hosted sharing and comment Threads are not shipped yet.",
    ].join("\n"),
  });
});
cli.version(version);
cli.parse();

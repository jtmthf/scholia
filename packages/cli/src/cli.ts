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

// Resolve the owner credential for an ops command the same way `share`/`chats` do:
// an explicit --site, else the newest stored credential; token from --token,
// SCHOLIA_TOKEN, or the stored credential. Owner ops need the OWNER token.
async function resolveOwner(options: {
  server: string;
  site?: string;
  token?: string;
}): Promise<{ server: string; slug: string; token: string; cred?: SiteCredential }> {
  const server = (options.server as string).replace(/\/+$/, "");
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
    throw new Error("no owner token — pass --token, set SCHOLIA_TOKEN, or run `scholia share` first");
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
    .action(async (path: string | undefined, options: any) => {
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

  // Chats (M8): `scholia chats` prints the viewer's own private Chats as JSON, using
  // a viewer-scoped token. Resolves the credential the same way `share` does — an
  // explicit --site, else the newest stored credential. Owner tokens get a 403 from
  // the endpoint (acceptable — Chats are a viewer-tier surface).
  cli
    .command("chats", "List your viewer's private Chats as JSON")
    .option("--server <url>", "Scholia server base URL", {
      default: process.env.SCHOLIA_SERVER ?? "http://localhost:8787",
    })
    .option("--site <slug>", "Site slug to query (defaults to the newest stored credential)")
    .option("--token <token>", "Viewer-scoped token (defaults to SCHOLIA_TOKEN or the stored credential)")
    .option("--since <iso>", "ISO 8601 timestamp; only Chats with a comment newer than this")
    .option("--path <p>", "Filter to Chats anchored to this page path")
    .action(async (options: any) => {
      try {
        const server = (options.server as string).replace(/\/+$/, "");
        const store = await loadCredentials();
        const entries = Object.values(store);
        const cred = options.site
          ? entries.find((e) => e.slug === options.site)
          : entries.length
            ? entries.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
            : undefined;

        const slug: string | undefined = options.site ?? cred?.slug ?? process.env.SCHOLIA_SITE;
        const token: string | undefined = options.token ?? process.env.SCHOLIA_TOKEN ?? cred?.token;
        if (!slug) throw new Error("no site — pass --site <slug> or run `scholia share` first");
        if (!token) throw new Error("no token — pass --token, set SCHOLIA_TOKEN, or run `scholia share` first");

        const client = new ScholiaClient({ server, token, slug });
        const { chats } = await client.listChats({ since: options.since, path: options.path });
        console.log(JSON.stringify(chats, null, 2));
      } catch (err) {
        console.error(`[scholia] ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // ---- M9: Owner moderation & ops ----

  const OPS_DEFAULT_SERVER = { default: process.env.SCHOLIA_SERVER ?? "http://localhost:8787" };

  // `scholia state <state>` — set the Site moderation posture (open|read_only|frozen).
  cli
    .command("state <state>", "Set the Site state: open | read_only | frozen")
    .option("--server <url>", "Scholia server base URL", OPS_DEFAULT_SERVER)
    .option("--site <slug>", "Site slug (defaults to the newest stored credential)")
    .option("--token <token>", "Owner token (defaults to SCHOLIA_TOKEN or the stored credential)")
    .action(async (state: string, options: any) => {
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
    .action(async (options: any) => {
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
    .action(async (options: any) => {
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
    .action(async (options: any) => {
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

// Local Preview (ADR-0010): `scholia <path>` renders a local file or folder in
// the browser — no account, no token, no network. The default entry point.
const DEFAULT_PORT = 3000;

cli
  .command("[target]", "Preview a local markdown file or directory")
  .option("-p, --port <port>", `Port to listen on (default: ${DEFAULT_PORT}; errors if an explicit port is taken)`)
  .option("--host <host>", "Host to bind", { default: "localhost" })
  .option("--no-open", "Do not open the browser automatically")
  .option("--no-mdx", "Disable MDX rendering (.mdx served as plain markdown)")
  .action(async (target: string | undefined, options: any) => {
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
      });
    } catch (err) {
      console.error(`[scholia] ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    if (!explicitPort && server.port !== DEFAULT_PORT) {
      console.log(`\n  [scholia] port ${DEFAULT_PORT} is in use — falling back to ${server.port}`);
    }

    console.log(`\n  scholia preview — ${isFile ? "file" : "directory"}: ${input}`);
    console.log(`  ➜  ${server.url}\n`);

    if (options.open !== false) {
      await open(server.url).catch(() => {
        console.log("  (could not open browser automatically)");
      });
    }

    const shutdown = async () => {
      await server.close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
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

#!/usr/bin/env node
import { stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { cac } from "cac";
import open from "open";
import { startServer } from "@collab/local";
import {
  CollabClient,
  loadCredentials,
  removeCredential,
  saveCredential,
  type SiteCredential,
} from "@collab/client";
import { share } from "./share.js";

const cli = cac("collab");

// Resolve the owner credential for an ops command the same way `share`/`chats` do:
// an explicit --site, else the newest stored credential; token from --token,
// COLLAB_TOKEN, or the stored credential. Owner ops need the OWNER token.
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

  const slug = options.site ?? cred?.slug ?? process.env.COLLAB_SITE;
  const token = options.token ?? process.env.COLLAB_TOKEN ?? cred?.token;
  if (!slug) throw new Error("no site — pass --site <slug> or run `collab share` first");
  if (!token)
    throw new Error("no owner token — pass --token, set COLLAB_TOKEN, or run `collab share` first");
  return { server, slug, token, cred };
}

// Share (ADR-0010): `collab share <path>` promotes local content to a hosted,
// public Site — the explicit step out of local-first Preview. M3 accepts a
// single file, a directory (walked recursively), or a .zip archive.
// M10 adds `--pr owner/repo#123` and `--ref owner/repo@<ref>` to create a Site
// from a GitHub content source (the server fetches bytes; no local path needed).
cli
  .command("share [path]", "Upload a file, folder, or zip and host it as a public Site")
  .option("--server <url>", "Collab server base URL", {
    default: process.env.COLLAB_SERVER ?? "http://localhost:8787",
  })
  .option("--new", "Create a fresh Site even if a .collab marker exists")
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
      console.error(`[collab] ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// Chats (M8): `collab chats` prints the viewer's own private Chats as JSON, using
// a viewer-scoped token. Resolves the credential the same way `share` does — an
// explicit --site, else the newest stored credential. Owner tokens get a 403 from
// the endpoint (acceptable — Chats are a viewer-tier surface).
cli
  .command("chats", "List your viewer's private Chats as JSON")
  .option("--server <url>", "Collab server base URL", {
    default: process.env.COLLAB_SERVER ?? "http://localhost:8787",
  })
  .option("--site <slug>", "Site slug to query (defaults to the newest stored credential)")
  .option("--token <token>", "Viewer-scoped token (defaults to COLLAB_TOKEN or the stored credential)")
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

      const slug: string | undefined = options.site ?? cred?.slug ?? process.env.COLLAB_SITE;
      const token: string | undefined = options.token ?? process.env.COLLAB_TOKEN ?? cred?.token;
      if (!slug) throw new Error("no site — pass --site <slug> or run `collab share` first");
      if (!token) throw new Error("no token — pass --token, set COLLAB_TOKEN, or run `collab share` first");

      const client = new CollabClient({ server, token, slug });
      const { chats } = await client.listChats({ since: options.since, path: options.path });
      console.log(JSON.stringify(chats, null, 2));
    } catch (err) {
      console.error(`[collab] ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ---- M9: Owner moderation & ops ----

const OPS_DEFAULT_SERVER = { default: process.env.COLLAB_SERVER ?? "http://localhost:8787" };

// `collab state <state>` — set the Site moderation posture (open|read_only|frozen).
cli
  .command("state <state>", "Set the Site state: open | read_only | frozen")
  .option("--server <url>", "Collab server base URL", OPS_DEFAULT_SERVER)
  .option("--site <slug>", "Site slug (defaults to the newest stored credential)")
  .option("--token <token>", "Owner token (defaults to COLLAB_TOKEN or the stored credential)")
  .action(async (state: string, options: any) => {
    try {
      if (!["open", "read_only", "frozen"].includes(state)) {
        throw new Error(`invalid state "${state}" — expected open, read_only, or frozen`);
      }
      const { server, slug, token } = await resolveOwner(options);
      const client = new CollabClient({ server, token, slug });
      const res = await client.setState(state as "open" | "read_only" | "frozen");
      console.log(`[collab] ${slug} is now ${res.state}`);
    } catch (err) {
      console.error(`[collab] ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// `collab rotate-share` — mint a fresh Share URL (invalidates the old link).
cli
  .command("rotate-share", "Rotate the Share URL (kills a leaked link)")
  .option("--server <url>", "Collab server base URL", OPS_DEFAULT_SERVER)
  .option("--site <slug>", "Site slug (defaults to the newest stored credential)")
  .option("--token <token>", "Owner token (defaults to COLLAB_TOKEN or the stored credential)")
  .action(async (options: any) => {
    try {
      const { server, slug, token, cred } = await resolveOwner(options);
      const client = new CollabClient({ server, token, slug });
      const res = await client.rotateShare();
      // Re-key the stored credential under the new slug; the token is unchanged.
      if (cred) {
        await removeCredential(slug);
        await saveCredential({ ...cred, slug: res.slug, shareUrl: res.shareUrl });
      }
      console.log(`[collab] new Share URL: ${res.shareUrl}`);
      console.log(`[collab] the old link no longer resolves.`);
    } catch (err) {
      console.error(`[collab] ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// `collab rotate-token` — mint a fresh owner token (revokes the old ones).
cli
  .command("rotate-token", "Rotate the owner token / Agent URL (revokes the old token)")
  .option("--server <url>", "Collab server base URL", OPS_DEFAULT_SERVER)
  .option("--site <slug>", "Site slug (defaults to the newest stored credential)")
  .option("--token <token>", "Owner token (defaults to COLLAB_TOKEN or the stored credential)")
  .action(async (options: any) => {
    try {
      const { server, slug, token, cred } = await resolveOwner(options);
      const client = new CollabClient({ server, token, slug });
      const res = await client.rotateToken();
      if (cred) await saveCredential({ ...cred, token: res.token });
      console.log(`[collab] new owner token: ${res.token}`);
      console.log(`[collab] new Agent URL:  ${res.agentUrl}`);
      console.log(`[collab] the previous owner token / Agent URL is now revoked.`);
    } catch (err) {
      console.error(`[collab] ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// `collab delete-site` — permanently delete the Site. Requires --yes (no prompt).
cli
  .command("delete-site", "Permanently delete the Site and all its data")
  .option("--server <url>", "Collab server base URL", OPS_DEFAULT_SERVER)
  .option("--site <slug>", "Site slug (defaults to the newest stored credential)")
  .option("--token <token>", "Owner token (defaults to COLLAB_TOKEN or the stored credential)")
  .option("--yes", "Confirm the deletion (required — this is irreversible)")
  .action(async (options: any) => {
    try {
      const { server, slug, token } = await resolveOwner(options);
      if (!options.yes) {
        throw new Error(
          `this permanently deletes Site "${slug}" and every Version/comment. Re-run with --yes to confirm.`,
        );
      }
      const client = new CollabClient({ server, token, slug });
      await client.deleteSite();
      await removeCredential(slug);
      console.log(`[collab] deleted Site ${slug}.`);
    } catch (err) {
      console.error(`[collab] ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// Local Preview (ADR-0010): `collab <path>` renders a local file or folder in
// the browser — no account, no token, no network. The default entry point.
cli
  .command("[target]", "Preview a local markdown file or directory")
  .option("-p, --port <port>", "Port to listen on", { default: 3000 })
  .option("--host <host>", "Host to bind", { default: "localhost" })
  .option("--no-open", "Do not open the browser automatically")
  .option("--no-mdx", "Disable MDX rendering (.mdx served as plain markdown)")
  .action(async (target: string | undefined, options: any) => {
    const input = resolve(target ?? ".");

    const info = await stat(input).catch(() => null);
    if (!info) {
      console.error(`[collab] not found: ${input}`);
      process.exit(1);
    }

    const isFile = info.isFile();
    const rootDir = isFile ? dirname(input) : input;

    const server = await startServer({
      rootDir,
      singleFile: isFile ? input : undefined,
      port: Number(options.port),
      host: options.host,
      mdxEnabled: options.mdx !== false,
      open: options.open !== false,
    });

    console.log(`\n  collab preview — ${isFile ? "file" : "directory"}: ${input}`);
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

cli.help();
cli.version("0.0.0");
cli.parse();

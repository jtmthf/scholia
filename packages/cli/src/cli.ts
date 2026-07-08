#!/usr/bin/env node
import { stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { cac } from "cac";
import open from "open";
import { startServer } from "@collab/local";
import { CollabClient, loadCredentials } from "@collab/client";
import { share } from "./share.js";

const cli = cac("collab");

// Share (ADR-0010): `collab share <path>` promotes local content to a hosted,
// public Site — the explicit step out of local-first Preview. M3 accepts a
// single file, a directory (walked recursively), or a .zip archive.
cli
  .command("share <path>", "Upload a file, folder, or zip and host it as a public Site")
  .option("--server <url>", "Collab server base URL", {
    default: process.env.COLLAB_SERVER ?? "http://localhost:8787",
  })
  .option("--new", "Create a fresh Site even if a .collab marker exists")
  .option("--site <slug>", "Re-upload a new Version to this specific Site slug")
  .action(async (path: string, options: any) => {
    try {
      await share(path, { server: options.server, forceNew: options.new, site: options.site });
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

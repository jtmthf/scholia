#!/usr/bin/env node
import { stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { cac } from "cac";
import open from "open";
import { startServer } from "@collab/local";
import { share } from "./share.js";

const cli = cac("collab");

// Share (ADR-0010): `collab share <file.md>` promotes a local file to a hosted,
// public Site — the explicit step out of local-first Preview. M2 hosts a single
// Markdown Page.
cli
  .command("share <file>", "Upload a markdown file and host it as a public Site")
  .option("--server <url>", "Collab server base URL", {
    default: process.env.COLLAB_SERVER ?? "http://localhost:8787",
  })
  .action(async (file: string, options: any) => {
    try {
      await share(file, { server: options.server });
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

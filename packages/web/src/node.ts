import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createApp } from "./server.js";
import type { Assets } from "./document.js";

// Production entry: serve the built client bundle as static files, then let the
// Hono app render the shell for everything else. Built by `vite build --ssr`, so the
// react → preact/compat alias applies to this half too, exactly as it does in dev.

/** Where `vite build` put the client bundle, resolved from this file's own location. */
const CLIENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "client");

/** The entry chunk Vite emitted and the CSS it pulled in, read from the manifest. */
async function readAssets(): Promise<Assets> {
  const raw = await readFile(join(CLIENT_DIR, ".vite", "manifest.json"), "utf8");
  const manifest = JSON.parse(raw) as Record<
    string,
    { file: string; css?: string[]; isEntry?: boolean }
  >;
  const entry = Object.values(manifest).find((chunk) => chunk.isEntry);
  if (!entry) throw new Error("No entry chunk in the client manifest — run `vite build` first.");
  return { js: [`/${entry.file}`], css: (entry.css ?? []).map((file) => `/${file}`) };
}

const app = new Hono();
// Rooted at this file rather than at the working directory, so `start` behaves the
// same however it's invoked.
app.use("/assets/*", serveStatic({ root: CLIENT_DIR }));
app.route("/", createApp(await readAssets()));

const port = Number(process.env.PORT ?? 5173);
serve({ fetch: app.fetch, port });
console.log(`[scholia] viewer listening on http://localhost:${port}`);

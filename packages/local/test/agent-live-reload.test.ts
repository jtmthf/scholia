// An agent's Comment reaching a reader who has the preview open (ADR-0020).
//
// The agent writes in-process — no server, no port, no HTTP — into the same
// Sidecar the preview is serving from. Two writers is the normal case, and the
// payoff is this: the reader's browser finds out over the live-reload channel
// that already exists, with nothing built for it. That only holds if the
// watcher looks inside `.scholia`, which the blanket dotfile rule used to
// prevent (see watch.ts).

import { expect } from "vitest";
import { test as tmpTest } from "./helpers/tmp.js";
import { createLocalApi } from "@scholia/sidecar";
import { startServer, type RunningServer, type StartOptions } from "../src/server.js";

async function waitUntilAccepting(url: string, attempts = 100): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await fetch(`${url}/__probe__`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  throw new Error(`server at ${url} never started accepting connections`);
}

const test = tmpTest.extend<{
  serve: (overrides?: Partial<StartOptions>) => Promise<RunningServer>;
}>({
  serve: async ({ tmp }, use) => {
    const servers: RunningServer[] = [];
    let basePort = 39500;
    const launch = async (overrides: Partial<StartOptions> = {}) => {
      basePort += 50;
      const server = await startServer({
        rootDir: tmp.root,
        port: basePort,
        host: "localhost",
        mdxEnabled: true,
        open: false,
        ...overrides,
      });
      servers.push(server);
      await waitUntilAccepting(server.url);
      return server;
    };
    await use(launch);
    await Promise.all(servers.map((s) => s.close()));
  },
});

/** Resolves the first time the live-reload channel says "reload". */
async function nextReload(url: string, timeoutMs = 8000): Promise<void> {
  const controller = new AbortController();
  const res = await fetch(`${url}/__livereload`, { signal: controller.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();

  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error("live-reload stream ended without a reload");
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes("data: reload")) return;
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

test("a Comment written by an agent reaches an open preview", async ({ tmp, serve }) => {
  await tmp.write("guide.md", "# Guide\n\nThe second paragraph.\n");
  const { url } = await serve();

  // The reader has the Page open and is listening.
  const reloaded = nextReload(url);

  // The agent, elsewhere, with no idea a server is running.
  await createLocalApi({ rootDir: tmp.root }).comment({
    page: "guide.md",
    body: "this contradicts the intro",
    agent: "Claude Code",
  });

  await reloaded;

  // And what the reader's browser re-fetches now carries it.
  const html = await (await fetch(`${url}/guide.md`)).text();
  expect(html).toContain("this contradicts the intro");
});

test("it works in single-file mode, where only one file is watched", async ({ tmp, serve }) => {
  const file = await tmp.write("guide.md", "# Guide\n");
  const { url } = await serve({ singleFile: file });

  const reloaded = nextReload(url);
  await createLocalApi({ rootDir: tmp.root }).comment({
    page: "guide.md",
    body: "still gets through",
  });
  await reloaded;

  const html = await (await fetch(`${url}/`)).text();
  expect(html).toContain("still gets through");
});

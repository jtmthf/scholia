import { expect } from "vitest";
import { test as tmpTest } from "./helpers/tmp.js";
import { startServer, type RunningServer, type StartOptions } from "../src/server.js";

// `serve()` (via @hono/node-server) begins listening on a later tick, so the
// returned URL may briefly refuse connections. Poll until the socket accepts
// any request (a 404 still means it's up) before handing the server back.
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

// Extends the temp-dir fixture with a launcher that tracks every server it
// starts and closes them all on teardown (stopping the chokidar watcher too).
// Each launch gets its own port range so back-to-back tests can't collide while
// a previous server is still releasing its socket.
const test = tmpTest.extend<{
  serve: (overrides?: Partial<StartOptions>) => Promise<RunningServer>;
}>({
  serve: async ({ tmp }, use) => {
    const servers: RunningServer[] = [];
    let basePort = 38000;
    const launch = async (overrides: Partial<StartOptions> = {}) => {
      basePort += 50; // findPort scans 25 ports up; 50 keeps ranges disjoint
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

test("renders the directory index (README) with a nav sidebar", async ({ tmp, serve }) => {
  await tmp.write("README.md", "# Home\n\nWelcome to the docs.\n");
  const { url } = await serve();

  const res = await fetch(`${url}/`);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("<title>Home</title>");
  expect(html).toContain("Welcome to the docs.");
  expect(html).toContain("has-sidebar");
});

test("resolves an extension-less URL to the matching .md file", async ({ tmp, serve }) => {
  await tmp.write("README.md", "# Home\n");
  await tmp.write("guide/intro.md", "# Intro\n\nNested body text.\n");
  const { url } = await serve();

  const res = await fetch(`${url}/guide/intro`);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("Nested body text.");
});

test("returns 404 for paths that resolve to nothing", async ({ tmp, serve }) => {
  await tmp.write("README.md", "# Home\n");
  const { url } = await serve();

  expect((await fetch(`${url}/does-not-exist`)).status).toBe(404);
});

test("the /search endpoint returns matching documents as JSON", async ({ tmp, serve }) => {
  await tmp.write("README.md", "# Home\n");
  await tmp.write("topic.md", "# Topic\n\nThe magic word is xylophone.\n");
  const { url } = await serve();

  const res = await fetch(`${url}/search?q=xylophone`);
  expect(res.headers.get("content-type")).toContain("application/json");
  const hits = await res.json();
  expect(Array.isArray(hits)).toBe(true);
  expect(hits.some((h: { path: string }) => h.path.startsWith("/topic.md"))).toBe(true);
});

test("serves sibling non-document files with the correct content-type", async ({ tmp, serve }) => {
  await tmp.write("README.md", "# Home\n");
  await tmp.write("logo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const { url } = await serve();

  const res = await fetch(`${url}/logo.png`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/png");
});

test("single-file mode renders that one file for any path, without a sidebar", async ({ tmp, serve }) => {
  const file = await tmp.write("solo.md", "# Solo Doc\n\nOnly this renders.\n");
  await tmp.write("other.md", "# Other\n");
  const { url } = await serve({ singleFile: file });

  const res = await fetch(`${url}/anything/at/all`);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("Only this renders.");
  expect(html).not.toContain("has-sidebar");
});

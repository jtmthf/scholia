import { expect } from "vitest";
import { createServer } from "node:net";
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

test("renders the directory index (README) with a Nav pane", async ({ tmp, serve }) => {
  await tmp.write("README.md", "# Home\n\nWelcome to the docs.\n");
  const { url } = await serve();

  const res = await fetch(`${url}/`);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("<title>Home</title>");
  expect(html).toContain("Welcome to the docs.");
  expect(html).toContain("has-nav");
});

// Every other test in this file writes a root README.md, so the Entry Page
// fallback path (no index/README at all) never runs. It shares `pickEntryPath`
// with the hosted path (CONTEXT "Local Preview"): the first top-level Page
// alphabetically, not the first Page in nav-traversal order.
test("falls back to the first top-level Page alphabetically when the root has no index/README", async ({
  tmp,
  serve,
}) => {
  await tmp.write("zebra.md", "# Zebra\n");
  await tmp.write("apple.md", "# Apple\n");
  await tmp.write("guide/intro.md", "# Intro\n");
  const { url } = await serve();

  const res = await fetch(`${url}/`);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("<title>Apple</title>");
});

// Entry Page resolution applies to any directory, not just the Site root
// (CONTEXT "Entry Page") — a nested directory with its own README must
// resolve to that README rather than falling through to something else.
test("resolves a nested directory's own Entry Page, not the root's", async ({ tmp, serve }) => {
  await tmp.write("README.md", "# Home\n");
  await tmp.write("guide/README.md", "# Guide Home\n");
  await tmp.write("guide/intro.md", "# Intro\n");
  const { url } = await serve();

  const res = await fetch(`${url}/guide/`);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("<title>Guide Home</title>");
});

// A nested directory with no index/README of its own still resolves to the
// first top-level Page within *that* directory, not some other nav-order Page.
test("a nested directory with no index/README falls back to its own first Page alphabetically", async ({
  tmp,
  serve,
}) => {
  await tmp.write("README.md", "# Home\n");
  await tmp.write("guide/zebra.md", "# Zebra\n");
  await tmp.write("guide/apple.md", "# Apple\n");
  const { url } = await serve();

  const res = await fetch(`${url}/guide/`);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("<title>Apple</title>");
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

// `localhost` resolves to ::1 on macOS and 127.0.0.1 elsewhere, so binding it
// as a single name leaves the other loopback address refusing connections —
// the browser works while `curl 127.0.0.1:<port>` fails. Both must answer.
test("the default host answers on both IPv4 and IPv6 loopback", async ({ tmp, serve }) => {
  await tmp.write("README.md", "# Home\n\nDual stack.\n");
  const { port } = await serve();

  const reachable = async (address: string): Promise<boolean> => {
    try {
      const res = await fetch(`http://${address}:${port}/`);
      return res.status === 200 && (await res.text()).includes("Dual stack.");
    } catch {
      return false;
    }
  };

  // IPv4 loopback is always present; IPv6 only where the stack exists, and a
  // machine without it must not fail this test.
  expect(await reachable("127.0.0.1")).toBe(true);

  const hasIpv6 = await new Promise<boolean>((res) => {
    const probe = createServer();
    probe.once("error", () => res(false));
    probe.once("listening", () => probe.close(() => res(true)));
    probe.listen(0, "::1");
  });
  if (hasIpv6) expect(await reachable("[::1]")).toBe(true);
});

test("an explicit --host is bound verbatim, not expanded to both stacks", async ({
  tmp,
  serve,
}) => {
  await tmp.write("README.md", "# Home\n\nIPv4 only.\n");
  const { port } = await serve({ host: "127.0.0.1" });

  const res = await fetch(`http://127.0.0.1:${port}/`);
  expect(res.status).toBe(200);

  // ::1 was never requested, so nothing should be listening there.
  await expect(fetch(`http://[::1]:${port}/`)).rejects.toThrow();
});

test("single-file mode renders that one file for any path, without a Nav pane", async ({
  tmp,
  serve,
}) => {
  const file = await tmp.write("solo.md", "# Solo Doc\n\nOnly this renders.\n");
  await tmp.write("other.md", "# Other\n");
  const { url } = await serve({ singleFile: file });

  const res = await fetch(`${url}/anything/at/all`);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("Only this renders.");
  expect(html).not.toContain("has-nav");
});

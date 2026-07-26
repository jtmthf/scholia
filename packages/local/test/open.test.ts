import { describe, expect, vi } from "vitest";
import { test as tmpTest } from "./helpers/tmp.js";
import { startServer, type RunningServer, type StartOptions } from "../src/server.js";
import type { ResolvedEditor } from "../src/editor.js";

// The server resolves an editor once at startup (ADR-0017) — stub both the
// probe and the spawn so these tests are deterministic in CI regardless of
// what's actually on the host's PATH, and never launch a real process.
// `vi.hoisted` so these are safe to reference from the (hoisted) `vi.mock`
// factory below.
const { resolveEditor, openInEditor } = vi.hoisted(() => ({
  resolveEditor: vi.fn<() => Promise<ResolvedEditor | null>>(),
  openInEditor: vi.fn(),
}));
vi.mock("../src/editor.js", () => ({ resolveEditor, openInEditor }));

const FAKE_EDITOR: ResolvedEditor = { command: "fake-editor", args: [] };

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
    let basePort = 39000;
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

describe("POST /__open (ADR-0017)", () => {
  test("guard 1: rejects non-POST requests", async ({ tmp, serve }) => {
    resolveEditor.mockResolvedValueOnce(FAKE_EDITOR);
    await tmp.write("README.md", "# Home\n");
    const { url } = await serve();

    const res = await fetch(`${url}/__open`, { method: "GET" });
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(openInEditor).not.toHaveBeenCalled();
  });

  test("guard 2: rejects a cross-site Sec-Fetch-Site header", async ({ tmp, serve }) => {
    resolveEditor.mockResolvedValueOnce(FAKE_EDITOR);
    await tmp.write("README.md", "# Home\n");
    const { url } = await serve();

    const res = await fetch(`${url}/__open`, {
      method: "POST",
      headers: { "content-type": "application/json", "Sec-Fetch-Site": "cross-site" },
      body: JSON.stringify({ path: "README.md" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(openInEditor).not.toHaveBeenCalled();
  });

  test("guard 3: rejects a path-traversal attempt", async ({ tmp, serve }) => {
    resolveEditor.mockResolvedValueOnce(FAKE_EDITOR);
    await tmp.write("README.md", "# Home\n");
    const { url } = await serve();

    const res = await fetch(`${url}/__open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "../../../../../../etc/passwd" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(openInEditor).not.toHaveBeenCalled();
  });

  test("responds ok:false without spawning when no editor resolved at startup", async ({
    tmp,
    serve,
  }) => {
    resolveEditor.mockResolvedValueOnce(null);
    await tmp.write("README.md", "# Home\n");
    const { url } = await serve();

    const res = await fetch(`${url}/__open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "README.md" }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(openInEditor).not.toHaveBeenCalled();
  });

  test("happy path: a same-origin POST for a real in-root file spawns the resolved editor", async ({
    tmp,
    serve,
  }) => {
    resolveEditor.mockResolvedValueOnce(FAKE_EDITOR);
    const file = await tmp.write("README.md", "# Home\n");
    const { url } = await serve();

    const res = await fetch(`${url}/__open`, {
      method: "POST",
      headers: { "content-type": "application/json", "Sec-Fetch-Site": "same-origin" },
      body: JSON.stringify({ path: "README.md" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(openInEditor).toHaveBeenCalledTimes(1);
    expect(openInEditor).toHaveBeenCalledWith(FAKE_EDITOR, file);
  });

  test("a missing Sec-Fetch-Site header is allowed through guard 2 (e.g. curl)", async ({
    tmp,
    serve,
  }) => {
    resolveEditor.mockResolvedValueOnce(FAKE_EDITOR);
    await tmp.write("README.md", "# Home\n");
    const { url } = await serve();

    const res = await fetch(`${url}/__open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "README.md" }),
    });
    expect(res.status).toBe(200);
  });
});

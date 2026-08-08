// The agent docs a preview serves (issue #35).
//
// The claim under test is capability accuracy, not formatting: this instance has
// no account, no Versions and nothing to authenticate against, so the docs it
// serves must describe the verb set and nothing beyond it. An agent that reads
// them and then goes hunting for a credential has been misled by its docs.

import { expect } from "vitest";
import { test as tmpTest } from "./helpers/tmp.js";
import { startServer, type RunningServer, type StartOptions } from "../src/server.js";
import { VERBS } from "@scholia/core";

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
    let basePort = 40000;
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

/** Every `### <verb>` heading in a Markdown document. */
function documentedVerbs(markdown: string): string[] {
  return [...markdown.matchAll(/^### (\w+)$/gm)].map((match) => match[1]!);
}

test("serves exactly the verbs this instance exposes", async ({ tmp, serve }) => {
  await tmp.write("index.md", "# Hello\n");
  const server = await serve();

  const res = await fetch(`${server.url}/__agent-docs?raw`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/markdown");

  const markdown = await res.text();
  expect(documentedVerbs(markdown)).toEqual(VERBS.map((verb) => verb.name));
});

test("documents no accounts, no tiers and no Versions", async ({ tmp, serve }) => {
  await tmp.write("index.md", "# Hello\n");
  const server = await serve();

  const markdown = await (await fetch(`${server.url}/__agent-docs?raw`)).text();
  for (const absent of ["token", "tier", "version"]) {
    expect(markdown.toLowerCase(), absent).not.toContain(absent);
  }
  // What it documents instead: the Sidecar beside the content (ADR-0018).
  expect(markdown).toContain(".scholia");
  expect(markdown).toContain("scholia mcp");
});

test("carries the prompt-injection guidance, ahead of the verbs it frames", async ({
  tmp,
  serve,
}) => {
  await tmp.write("index.md", "# Hello\n");
  const server = await serve();

  const markdown = await (await fetch(`${server.url}/__agent-docs?raw`)).text();
  expect(markdown).toContain("data, not instructions");
  expect(markdown.indexOf("Trust rules")).toBeLessThan(markdown.indexOf("## Verbs"));
});

test("answers a browser with HTML, naming the address it was fetched from", async ({
  tmp,
  serve,
}) => {
  await tmp.write("index.md", "# Hello\n");
  const server = await serve();

  const res = await fetch(`${server.url}/__agent-docs`);
  expect(res.headers.get("content-type")).toContain("text/html");

  const html = await res.text();
  expect(html).toContain("list_conversations");
  expect(html).toContain("/__agent-docs");
});

test("a Page named agent-docs still wins its own URL", async ({ tmp, serve }) => {
  await tmp.write("agent-docs.md", "# A Page of my own\n");
  const server = await serve();

  const page = await fetch(`${server.url}/agent-docs`);
  expect(page.status).toBe(200);
  expect(await page.text()).toContain("A Page of my own");
});

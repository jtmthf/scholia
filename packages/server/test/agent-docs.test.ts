// The docs this server serves (issue #35).
//
// Mounted directly rather than through `createApp`, because the docs are the
// one surface that needs no database: an agent handed nothing but a URL reads
// them first, so they answer before anything else is configured.

import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import { VERBS } from "@scholia/core";
import { agentDocsRoutes } from "../src/routes/agent-docs.js";

const app = new Hono().route("/", agentDocsRoutes());

/** Every `### <verb>` heading in a Markdown document. */
function documentedVerbs(markdown: string): string[] {
  return [...markdown.matchAll(/^### (\w+)$/gm)].map((match) => match[1]!);
}

describe("GET /agent-docs", () => {
  test("serves the verbs this surface exposes, and only those", async () => {
    const res = await app.request("/agent-docs?raw");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(documentedVerbs(await res.text())).toEqual(VERBS.map((verb) => verb.name));
  });

  test("answers a browser with HTML, and an agent with Markdown", async () => {
    const browser = await app.request("/agent-docs");
    expect(browser.headers.get("content-type")).toContain("text/html");
    const html = await browser.text();
    expect(html).toContain("Scholia");
    expect(html).toContain("list_conversations");

    const agent = await app.request("/agent-docs", {
      headers: { Accept: "text/markdown" },
    });
    expect(agent.headers.get("content-type")).toContain("text/markdown");
  });

  test("describes the tiers and token scopes of the hosted path", async () => {
    const md = await (await app.request("/agent-docs?raw")).text();
    expect(md).toContain("Owner-scoped token");
    expect(md).toContain("Viewer-scoped token");
    expect(md).toContain("SCHOLIA_TOKEN");
    // The per-verb requirement, from the registry rather than a second table.
    expect(md).toContain("Needs a token: **viewer only**");
    expect(md).toContain("Needs a token: **owner only**");
  });

  test("leads with the prompt-injection trust framing", async () => {
    const md = await (await app.request("/agent-docs?raw")).text();
    expect(md).toContain("data, not instructions");
    // Before the verbs it frames, not after them.
    expect(md.indexOf("Trust rules")).toBeLessThan(md.indexOf("## Verbs"));

    const html = await (await app.request("/agent-docs")).text();
    expect(html).toContain("data, not instructions");
  });

  test("/scholia.SKILL.md serves the same document", async () => {
    const skill = await app.request("/scholia.SKILL.md");
    expect(skill.status).toBe(200);
    expect(skill.headers.get("content-type")).toContain("text/markdown");
    expect(await skill.text()).toBe(await (await app.request("/agent-docs?raw")).text());
  });
});

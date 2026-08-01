import { afterEach, describe, expect, it } from "vitest";
import { render, serializeState } from "../src/entry-server.js";
import { DEV_ASSETS } from "../src/document.js";
import { siteFixture, stubApi, threadFixture, type ApiStub } from "./helpers/api-stub.js";

// The SSR route is where the router, the query cache and the comment layer all have
// to agree, and the only place the viewer produces HTML without a browser — so it's
// asserted here rather than only through Playwright.
let api: ApiStub;
afterEach(() => api?.restore());

describe("rendering a Site URL", () => {
  it("renders the chrome, Nav and content frame for the Entry Page", async () => {
    api = stubApi({ site: siteFixture() });

    const { html, status } = await render("http://localhost:5173/s/abc123", DEV_ASSETS);

    expect(status).toBe(200);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<span class="brand">scholia</span>');
    expect(html).toContain("Welcome to Scholia");
    expect(html).toContain("v3");
    // Nav renders because the Site has more than one Page.
    expect(html).toContain('href="/s/abc123/guide/intro.md"');
    // The content comes from the content origin, sandboxed (ADR-0003).
    expect(html).toContain('src="http://content.localhost:8787/abc123/3/README.md"');
    expect(html).toContain(
      'sandbox="allow-scripts allow-popups allow-top-navigation-by-user-activation"',
    );
  });

  it("resolves an explicit Page path, decoding it as the client router would", async () => {
    api = stubApi({ site: siteFixture() });

    const { html } = await render("http://localhost:5173/s/abc123/guide%2Fintro.md", DEV_ASSETS);

    expect(html).toContain('title="Intro"');
    expect(html).toContain("/abc123/3/guide/intro.md");
  });

  it("renders public Threads into the rail", async () => {
    api = stubApi({ site: siteFixture(), conversations: [threadFixture()] });

    const { html } = await render("http://localhost:5173/s/abc123", DEV_ASSETS);

    expect(html).toContain("Anchored (1)");
    expect(html).toContain("This claim needs a citation.");
    expect(html).toContain("Reviewer Jane");
  });

  // The server has no Viewer, so it asks for the anonymous view — the one every
  // reader can be shown. Sending a viewerId here would leak one reader's `mine`
  // flags into a document served to another.
  it("fetches Conversations anonymously, with no viewerId", async () => {
    api = stubApi({ site: siteFixture(), conversations: [threadFixture()] });

    await render("http://localhost:5173/s/abc123", DEV_ASSETS);

    expect(api.requests).toEqual(["/sites/abc123", "/sites/abc123/conversations?path=README.md"]);
  });

  it("omits everything that depends on who is reading", async () => {
    api = stubApi({ site: siteFixture(), conversations: [threadFixture()] });

    const { html } = await render("http://localhost:5173/s/abc123", DEV_ASSETS);

    // Owner affordances need the token in localStorage; Chats need a Viewer. Both
    // arrive after hydration (ADR-0011).
    expect(html).not.toContain("agent-prompt-btn");
    expect(html).not.toContain("rail-section--chats");
    expect(html).not.toContain("thread-action-btn--delete");
    // The reader hasn't named themselves, so the rail's composer will ask — but only
    // once they open it, not in the server's markup.
    expect(html).not.toContain("composer-name-row");
  });

  it("embeds the prefetched cache so the client doesn't refetch it", async () => {
    api = stubApi({ site: siteFixture(), conversations: [threadFixture()] });

    const { html } = await render("http://localhost:5173/s/abc123", DEV_ASSETS);

    expect(html).toContain("window.__SCHOLIA_STATE__=");
    // Both prefetched queries are there, keyed exactly as the client looks them up —
    // an anonymous Conversations fetch is `viewerId: null`.
    expect(html).toContain('["site","abc123",null]');
    expect(html).toContain('["conversations","abc123","README.md",null]');
  });

  // The hosted viewer names Versions in its Outdated note; the shared rail carries no
  // opinion about it, so this is the assertion that keeps the hosted copy honest.
  it("words the Outdated note in hosted terms", async () => {
    api = stubApi({
      site: siteFixture(),
      conversations: [threadFixture({ anchorStatus: "outdated" })],
    });

    const { html } = await render("http://localhost:5173/s/abc123", DEV_ASSETS);

    expect(html).toContain("These Threads no longer match the Latest Version.");
  });

  it("emits the client entry so the shell hydrates", async () => {
    api = stubApi({ site: siteFixture() });
    const { html } = await render("http://localhost:5173/s/abc123", DEV_ASSETS);
    expect(html).toContain('<script type="module" src="/src/entry-client.tsx">');
  });
});

describe("a pinned Version", () => {
  it("renders the historical banner and no comment rail", async () => {
    api = stubApi({ site: siteFixture({ version: 1, latestVersion: 3, isLatest: false }) });

    const { html } = await render("http://localhost:5173/s/abc123?v=1", DEV_ASSETS);

    expect(html).toContain("version-banner--historical");
    expect(html).toContain("Go to Latest");
    // Comments live on Latest (CONTEXT "Latest"), so a snapshot is content-only.
    expect(html).not.toContain("comment-rail");
  });

  it("carries the pin into every Nav link", async () => {
    api = stubApi({ site: siteFixture({ version: 1, latestVersion: 3, isLatest: false }) });

    const { html } = await render("http://localhost:5173/s/abc123?v=1", DEV_ASSETS);

    expect(html).toContain('href="/s/abc123/guide/intro.md?v=1"');
  });

  it("does not ask the API for Conversations at all", async () => {
    api = stubApi({ site: siteFixture({ isLatest: false }) });

    await render("http://localhost:5173/s/abc123?v=1", DEV_ASSETS);

    expect(api.requests).toEqual(["/sites/abc123?v=1"]);
  });
});

describe("status codes", () => {
  it("404s a slug with no Site, rendering the not-found view", async () => {
    api = stubApi({ site: "not-found" });

    const { html, status } = await render("http://localhost:5173/s/nope", DEV_ASSETS);

    expect(status).toBe(404);
    expect(html).toContain("<h1>Not found</h1>");
  });

  it("404s a URL that isn't a viewer route, without calling the API", async () => {
    api = stubApi({ site: siteFixture() });

    const { html, status } = await render("http://localhost:5173/", DEV_ASSETS);

    expect(status).toBe(404);
    expect(html).toContain("<h1>Not found</h1>");
    expect(api.requests).toEqual([]);
  });

  // An API this server can't reach is its own failure, not a missing Site — a 404
  // here would tell a reader their link is dead when it isn't.
  it("500s when the API is unreachable", async () => {
    api = stubApi({ site: "unreachable" });

    const { status } = await render("http://localhost:5173/s/abc123", DEV_ASSETS);

    expect(status).toBe(500);
  });
});

describe("serializeState", () => {
  it("escapes < so a Comment body can't close the script tag", () => {
    const serialized = serializeState({ body: "</script><img onerror=alert(1)>" });

    expect(serialized).not.toContain("</script>");
    expect(serialized).toContain("\\u003c/script>");
  });
});

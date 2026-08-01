import type { ConversationDTO, SiteMeta } from "../../src/api.js";

/** A two-Page Site on Latest, enough for Nav to render. */
export function siteFixture(over: Partial<SiteMeta> = {}): SiteMeta {
  return {
    slug: "abc123",
    state: "open",
    version: 3,
    latestVersion: 3,
    isLatest: true,
    entryPath: "README.md",
    contentBase: "http://content.localhost:8787/abc123/3",
    nav: [
      {
        type: "file",
        title: "Welcome to Scholia",
        urlPath: "README.md",
        fsPath: "README.md",
        order: 0,
      },
      {
        type: "file",
        title: "Intro",
        urlPath: "guide/intro.md",
        fsPath: "guide/intro.md",
        order: 1,
      },
    ],
    pages: [
      { path: "README.md", kind: "markdown", title: "Welcome to Scholia" },
      { path: "guide/intro.md", kind: "markdown", title: "Intro" },
    ],
    ...over,
  };
}

export function threadFixture(over: Partial<ConversationDTO> = {}): ConversationDTO {
  return {
    id: "conv-1",
    pagePath: "README.md",
    anchor: { textQuote: { exact: "zero-config" } },
    anchorStatus: "live",
    createdOrdinal: 3,
    resolved: false,
    resolvedBy: null,
    visibility: "public",
    comments: [
      {
        id: "cmt-1",
        author: { name: "Reviewer Jane", kind: "human", tier: "viewer", source: "native" },
        body: "This claim needs a citation.",
        createdAt: "2026-07-29T12:00:00.000Z",
        editedAt: null,
        deleted: false,
        mine: false,
        reactions: [],
      },
    ],
    ...over,
  };
}

export interface ApiStub {
  /** Every path+query the renderer asked the API for, in order. */
  requests: string[];
  restore: () => void;
}

/**
 * Stand in for the REST API. The viewer's server talks to it over HTTP like any
 * other client (it holds no database credentials), so stubbing `fetch` is the whole
 * seam.
 */
export function stubApi(routes: {
  site?: SiteMeta | "not-found" | "unreachable";
  conversations?: ConversationDTO[];
}): ApiStub {
  const original = globalThis.fetch;
  const requests: string[] = [];

  globalThis.fetch = async (input: string | URL | Request) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    requests.push(url.pathname + url.search);

    if (url.pathname.endsWith("/conversations")) {
      return Response.json(routes.conversations ?? []);
    }
    if (routes.site === "not-found") return new Response("nope", { status: 404 });
    if (routes.site === "unreachable") return new Response("boom", { status: 500 });
    if (routes.site) return Response.json(routes.site);
    return new Response("unexpected request", { status: 500 });
  };

  return {
    requests,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

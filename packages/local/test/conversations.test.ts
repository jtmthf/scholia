import { expect } from "vitest";
import { execFile as execFileCb } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { test as tmpTest } from "./helpers/tmp.js";
import { startServer, type RunningServer, type StartOptions } from "../src/server.js";
import { anchorFromSelection, toPagePath } from "../src/conversations.js";
import type { SourceMap } from "@scholia/core";

// The tracer bullet from the server's side (issue #28): a Conversation created
// against a Page persists to the Sidecar beside the content, and is served back
// with the next render of that Page. The browser half — selecting text, painting
// the Anchor — is covered in a real browser by e2e/tests/local-comments.spec.ts.

const execFile = promisify(execFileCb);

// A real repository, because Provenance is read by shelling out to git — a stub
// would be asserting that the stub works.
function git(cwd: string, ...args: string[]): Promise<unknown> {
  return execFile("git", args, { cwd });
}

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

interface ConversationsBody {
  conversations?: Array<{
    id: string;
    anchor: { textQuote: { exact: string }; sourceRange?: { start: number; end: number } } | null;
    comments: Array<{ body: string; author: { name: string } }>;
  }>;
  error?: string;
}

function comment(url: string, body: unknown, init: RequestInit = {}): Promise<Response> {
  return fetch(`${url}/__conversations`, {
    method: "POST",
    headers: { "content-type": "application/json", "Sec-Fetch-Site": "same-origin" },
    body: JSON.stringify(body),
    ...init,
  });
}

async function conversationsOn(url: string, page: string): Promise<ConversationsBody> {
  const res = await fetch(`${url}/__conversations?page=${encodeURIComponent(page)}`);
  return (await res.json()) as ConversationsBody;
}

// The `.scholia/conversations` directory, read as the bytes on disk rather than
// through the store — this is the artifact a teammate meets in a PR diff.
async function sidecarFiles(root: string): Promise<string[]> {
  const dir = join(root, ".scholia", "conversations");
  const names = (await readdir(dir)).filter((n) => n.endsWith(".yaml"));
  return Promise.all(names.map((n) => readFile(join(dir, n), "utf8")));
}

test("a comment on a selection persists to the Sidecar and comes back on the Page", async ({
  tmp,
  serve,
}) => {
  await tmp.write("guide.md", "# Guide\n\nThe anchor is the moat.\n");
  const { url } = await serve();

  const created = await comment(url, {
    page: "guide.md",
    body: "Is this still true?",
    selection: { quote: { exact: "the moat", prefix: "The anchor is " } },
  });
  expect(created.status).toBe(200);

  const { conversations } = (await created.json()) as ConversationsBody;
  expect(conversations).toHaveLength(1);
  expect(conversations![0]!.anchor!.textQuote.exact).toBe("the moat");
  expect(conversations![0]!.comments[0]!.body).toBe("Is this still true?");

  // Served back on a fresh read of the Page, which is what "survives a restart"
  // means for a store that holds nothing in memory.
  const reread = await conversationsOn(url, "guide.md");
  expect(reread.conversations).toHaveLength(1);

  // And it is in the first response, not fetched by the client.
  expect(await (await fetch(`${url}/guide.md`)).text()).toContain("Is this still true?");
});

test("a Page-level comment is stored with no Anchor", async ({ tmp, serve }) => {
  await tmp.write("guide.md", "# Guide\n\nBody.\n");
  const { url } = await serve();

  await comment(url, { page: "guide.md", body: "About the whole page." });

  const { conversations } = await conversationsOn(url, "guide.md");
  expect(conversations).toHaveLength(1);
  expect(conversations![0]!.anchor).toBeNull();
});

// The Source Map is what turns a selection over the *rendered* DOM into a range
// in the Source (CONTEXT "Source Map") — the server's half of the Anchor, since
// the browser never receives the map.
test("the selection's data-sm ids become a source range on the stored Anchor", async ({
  tmp,
  serve,
}) => {
  const source = "# Guide\n\nFirst paragraph.\n\nThe anchor is the moat.\n";
  await tmp.write("guide.md", source);
  const { url } = await serve();

  // The id the second paragraph was stamped with, read off the render itself
  // rather than guessed.
  const html = await (await fetch(`${url}/guide.md`)).text();
  const smId = Number(/<p data-sm="(\d+)">The anchor is the moat\./.exec(html)![1]);
  const contentHash = /data-content-hash="([0-9a-f]{64})"/.exec(html)![1]!;

  await comment(url, {
    page: "guide.md",
    body: "anchored",
    contentHash,
    selection: { quote: { exact: "the moat" }, smIds: [smId] },
  });

  const { conversations } = await conversationsOn(url, "guide.md");
  const range = conversations![0]!.anchor!.sourceRange!;
  expect(source.slice(range.start, range.end)).toBe("The anchor is the moat.");
});

// `data-sm` ids describe one particular render. Mapping them through a *later*
// one would silently produce a range into bytes the reader never saw, so a
// mismatched content hash costs the secondary hint rather than inventing it —
// the text-quote, which is the primary locator (ADR-0002), is untouched.
test("a selection captured against an older render yields no source range", async ({
  tmp,
  serve,
}) => {
  await tmp.write("guide.md", "# Guide\n\nFirst paragraph.\n\nThe anchor is the moat.\n");
  const { url } = await serve();

  const html = await (await fetch(`${url}/guide.md`)).text();
  const smId = Number(/<p data-sm="(\d+)">The anchor is the moat\./.exec(html)![1]);

  // The file moves on underneath the reader — an agent rewriting it mid-sentence
  // is the normal case locally, not an edge case.
  await tmp.write("guide.md", "# Guide\n\nA whole new opening.\n\nThe anchor is the moat.\n");

  const stale = await comment(url, {
    page: "guide.md",
    body: "captured before the edit",
    contentHash: "a".repeat(64),
    selection: { quote: { exact: "the moat" }, smIds: [smId] },
  });
  expect(stale.status).toBe(200);

  const { conversations } = await conversationsOn(url, "guide.md");
  const anchor = conversations![0]!.anchor!;
  expect(anchor.textQuote.exact).toBe("the moat");
  expect(anchor.sourceRange).toBeUndefined();
});

// The hash is the Comment's binding, so a value that is not a content hash is
// dropped rather than written — an unbound Comment beats one bound to nothing.
test("a contentHash that is not a hash is refused rather than stored", async ({ tmp, serve }) => {
  await tmp.write("guide.md", "# Guide\n");
  const { url } = await serve();

  await comment(url, { page: "guide.md", body: "nonsense binding", contentHash: "not-a-hash" });

  const header = (await sidecarFiles(tmp.root))[0]!.split("---\n")[0]!;
  expect(header).not.toContain("contentHash");
  expect(header).not.toContain("not-a-hash");
});

// CONTEXT "Comment": the binding is the content hash of the Page as it stood,
// and Provenance rides alongside as context (ADR-0018).
test("the header records the content hash the browser was given, not one re-read at submit", async ({
  tmp,
  serve,
}) => {
  await tmp.write("guide.md", "# Guide\n\nBody.\n");
  const { url } = await serve();

  const html = await (await fetch(`${url}/guide.md`)).text();
  const rendered = /data-content-hash="([0-9a-f]{64})"/.exec(html)![1]!;

  await comment(url, { page: "guide.md", body: "bound", contentHash: rendered });

  // Asserted against the bytes on disk: this file is the artifact a teammate
  // meets in a PR diff, and the header is written once and never rewritten.
  const [file] = await sidecarFiles(tmp.root);
  const header = file!.split("---\n")[0]!;
  expect(header).toContain(`contentHash: ${rendered}`);
});

// ADR-0007 / CONTEXT "Provenance": best-effort git facts recorded alongside the
// binding, never as the binding — the dominant local case is commenting on
// output an agent has just written and not committed, which is exactly the
// dirty-tree state this asserts.
test("Provenance is recorded where the served root is a git repository", async ({ tmp, serve }) => {
  await tmp.write("guide.md", "# Guide\n");
  await git(tmp.root, "init", "--initial-branch", "main");
  await git(tmp.root, "config", "user.email", "reviewer@example.com");
  await git(tmp.root, "config", "user.name", "Reviewer Jane");
  await git(tmp.root, "add", "guide.md");
  await git(tmp.root, "commit", "-m", "first");
  await tmp.write("guide.md", "# Guide\n\nEdited but not committed.\n");

  const { url } = await serve();
  await comment(url, { page: "guide.md", body: "on uncommitted work" });

  const header = (await sidecarFiles(tmp.root))[0]!.split("---\n")[0]!;
  expect(header).toMatch(/sha: [0-9a-f]{40}/);
  expect(header).toContain("branch: main");
  expect(header).toContain("dirty: true");
  // Identity comes from git config on the local path (CONTEXT "Identity").
  expect(header).toContain("author: Reviewer Jane");
});

test("a Conversation outside a git repository is stored with no Provenance", async ({
  tmp,
  serve,
}) => {
  await tmp.write("guide.md", "# Guide\n");
  const { url } = await serve();
  await comment(url, { page: "guide.md", body: "no repo here" });

  const header = (await sidecarFiles(tmp.root))[0]!.split("---\n")[0]!;
  expect(header).not.toContain("provenance");
});

test("the Sidecar self-ignores, so a teammate's git status stays clean", async ({ tmp, serve }) => {
  await tmp.write("guide.md", "# Guide\n");
  const { url } = await serve();
  await comment(url, { page: "guide.md", body: "hello" });

  expect((await readFile(join(tmp.root, ".scholia", ".gitignore"), "utf8")).trim()).toBe("*");
});

test("a reply is appended to the Conversation it answers", async ({ tmp, serve }) => {
  await tmp.write("guide.md", "# Guide\n");
  const { url } = await serve();

  const created = (await (
    await comment(url, { page: "guide.md", body: "first" })
  ).json()) as ConversationsBody;
  const id = created.conversations![0]!.id;

  const res = await fetch(`${url}/__conversations/${id}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json", "Sec-Fetch-Site": "same-origin" },
    body: JSON.stringify({ page: "guide.md", body: "second" }),
  });
  expect(res.status).toBe(200);

  const { conversations } = await conversationsOn(url, "guide.md");
  expect(conversations).toHaveLength(1);
  expect(conversations![0]!.comments.map((c) => c.body)).toEqual(["first", "second"]);
});

test("replying to a Conversation that does not exist is a 404, not a new file", async ({
  tmp,
  serve,
}) => {
  await tmp.write("guide.md", "# Guide\n");
  const { url } = await serve();

  const res = await fetch(`${url}/__conversations/00000000-0000-7000-8000-000000000001/comments`, {
    method: "POST",
    headers: { "content-type": "application/json", "Sec-Fetch-Site": "same-origin" },
    body: JSON.stringify({ page: "guide.md", body: "into the void" }),
  });
  expect(res.status).toBe(404);
});

test("an empty body is refused rather than stored", async ({ tmp, serve }) => {
  await tmp.write("guide.md", "# Guide\n");
  const { url } = await serve();

  expect((await comment(url, { page: "guide.md", body: "   " })).status).toBe(400);
  expect((await comment(url, { body: "orphan" })).status).toBe(400);
});

// Weaker than /__open's guards on purpose (see checkWriteRequest): a Comment is
// data in the reader's own tree, and a Tunnel exists so a guest can leave one.
test("a cross-site write is refused, and a GET cannot create anything", async ({ tmp, serve }) => {
  await tmp.write("guide.md", "# Guide\n");
  const { url } = await serve();

  const crossSite = await fetch(`${url}/__conversations`, {
    method: "POST",
    headers: { "content-type": "application/json", "Sec-Fetch-Site": "cross-site" },
    body: JSON.stringify({ page: "guide.md", body: "from somewhere else" }),
  });
  expect(crossSite.status).toBe(403);

  expect((await fetch(`${url}/__conversations`)).status).toBe(400);
  expect((await conversationsOn(url, "guide.md")).conversations).toEqual([]);
});

// Conversations are filed by Page path, which is a Page's identity across both
// paths (CONTEXT "Page") — so one Page's rail never shows another's.
test("Conversations are scoped to the Page they were left on", async ({ tmp, serve }) => {
  await tmp.write("a.md", "# A\n");
  await tmp.write("b.md", "# B\n");
  const { url } = await serve();

  await comment(url, { page: "a.md", body: "about A" });

  expect((await conversationsOn(url, "a.md")).conversations).toHaveLength(1);
  expect((await conversationsOn(url, "b.md")).conversations).toEqual([]);
  expect(await (await fetch(`${url}/b.md`)).text()).not.toContain("about A");
});

// AC: works for both Markdown and HTML Pages. An HTML Page renders inside the
// chrome, stamped for anchoring, and takes comments the same way.
test("an HTML Page renders in the chrome and takes an anchored comment", async ({ tmp, serve }) => {
  await tmp.write(
    "page.html",
    `<!doctype html><html><head><title>Hand Written</title><style>b { color: red }</style></head>` +
      `<body><h1>Hand Written</h1><p>The anchor is the moat.</p></body></html>`,
  );
  const { url } = await serve();

  const res = await fetch(`${url}/page.html`);
  expect(res.status).toBe(200);
  const html = await res.text();
  // Inside the chrome, not served as its own document.
  expect(html).toContain("<title>Hand Written</title>");
  expect(html).toContain(`class="markdown-body"`);
  expect(html).toContain("has-comments");
  // Its own stylesheet came along, and its content is stamped for anchoring.
  expect(html).toContain("b { color: red }");
  expect(html).toMatch(/<p data-sm="\d+">The anchor is the moat\.<\/p>/);

  await comment(url, {
    page: "page.html",
    body: "on an HTML Page",
    selection: { quote: { exact: "the moat" } },
  });

  const { conversations } = await conversationsOn(url, "page.html");
  expect(conversations).toHaveLength(1);
  expect(conversations![0]!.anchor!.textQuote.exact).toBe("the moat");
});

test("an HTML Page appears in the Nav under its own <title>", async ({ tmp, serve }) => {
  await tmp.write("README.md", "# Home\n");
  await tmp.write(
    "hand.html",
    `<!doctype html><html><head><title>Hand Written</title></head></html>`,
  );
  const { url } = await serve();

  const html = await (await fetch(`${url}/`)).text();
  expect(html).toContain(`<a href="/hand.html"`);
  expect(html).toContain("Hand Written");
});

// ---------------------------------------------------------------------------
// The pure mapping, without a server
// ---------------------------------------------------------------------------

test("anchorFromSelection keeps the quote primary and the structural hints secondary", () => {
  const sourceMap: SourceMap = {
    version: 1,
    entries: [
      { id: 0, tag: "p", start: 10, end: 40 },
      { id: 1, tag: "em", start: 20, end: 28 },
    ],
  };

  const anchor = anchorFromSelection(
    {
      quote: { exact: "the moat", prefix: "anchor is ", suffix: "." },
      smIds: [0, 1],
      xpath: "/html/body/p",
      css: "p",
    },
    sourceMap,
  );

  expect(anchor.textQuote).toEqual({ exact: "the moat", prefix: "anchor is ", suffix: "." });
  // The span of every id the selection touched, not just the innermost.
  expect(anchor.sourceRange).toEqual({ start: 10, end: 40 });
  expect(anchor.xpath).toBe("/html/body/p");
});

test("anchorFromSelection omits the source range when there is no Source Map", () => {
  // MDX renders without one, so an Anchor there is quote-only — which is the
  // primary locator anyway (ADR-0002).
  const anchor = anchorFromSelection({ quote: { exact: "x" }, smIds: [0] }, null);
  expect(anchor.sourceRange).toBeUndefined();
});

test("toPagePath strips the URL's leading slash so a Page keeps one identity", () => {
  expect(toPagePath("/guide/intro.md")).toBe("guide/intro.md");
  expect(toPagePath("guide/intro.md")).toBe("guide/intro.md");
});

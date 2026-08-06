// Which application a verb runs against, and that the surfaces cannot tell
// (ADR-0020).
//
// Local is the default and needs nothing: no server, no token, no credentials
// file. `--server` swaps in the HTTP adapter behind the same interface, so the
// verb that ran a moment ago against a directory now runs against a Site
// without knowing anything changed.

import { expect, vi, afterEach } from "vitest";
import { test } from "./helpers/tmp.js";
import { findVerb, type ConversationView } from "@scholia/core";
import { SidecarStore } from "@scholia/sidecar";
import { isRemote, resolveTarget } from "../src/target.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const comment = findVerb("comment")!;
const listConversations = findVerb("list_conversations")!;

test("with no server named, the verbs write the tree they are standing in", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("the local target must not reach the network"))),
  );

  const api = await resolveTarget({ root: tmp.root });
  const { data } = await comment.run(api, { page: "guide.md", body: "no server needed" });

  const stored = await new SidecarStore(tmp.root).getConversation((data as ConversationView).id);
  expect(stored!.comments[0]!.body).toBe("no server needed");
});

test("SCHOLIA_SERVER selects the hosted target for a surface that has no flags", () => {
  expect(isRemote({})).toBe(false);
  expect(isRemote({ server: "https://scholia.example" })).toBe(true);

  vi.stubEnv("SCHOLIA_SERVER", "https://scholia.example");
  // MCP over stdio is configured by environment, not argv — this is how a
  // hosted agent points it at a Site.
  expect(isRemote({})).toBe(true);
});

test("naming a server runs the same verb over HTTP", async () => {
  const fetchMock = vi.fn((url: string) => {
    expect(url).toContain("https://scholia.example/sites/docs/comments");
    return Promise.resolve(
      new Response(
        JSON.stringify({
          comments: [
            {
              conversationId: "c1",
              commentId: "m1",
              pagePath: "guide.md",
              anchor: null,
              anchorStatus: "live",
              resolved: false,
              version: 1,
              createdOrdinal: 1,
              author: { name: "Jane", kind: "human", tier: "viewer" },
              body: "hosted comment",
              createdAt: "2025-01-15T12:00:00.000Z",
              editedAt: null,
              mentions: [],
              reactions: [{ emoji: "👍", count: 2 }],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  });
  vi.stubGlobal("fetch", fetchMock);

  const api = await resolveTarget({
    server: "https://scholia.example",
    site: "docs",
    token: "tok",
  });
  const { data } = await listConversations.run(api, { page: "guide.md" });

  // The hosted API answers in Comments; the verb answers in Conversations, the
  // same shape the local target produces.
  const conversations = data as ConversationView[];
  expect(conversations).toHaveLength(1);
  expect(conversations[0]!.id).toBe("c1");
  expect(conversations[0]!.page).toBe("guide.md");
  expect(conversations[0]!.comment_count).toBe(1);
  expect(conversations[0]!.comments[0]!.body).toBe("hosted comment");
  expect(conversations[0]!.comments[0]!.reactions[0]!.count).toBe(2);
  expect(fetchMock).toHaveBeenCalledOnce();
});

test("a hosted target with nothing to identify the Site says so", async () => {
  vi.stubEnv("SCHOLIA_SITE", "");
  vi.stubEnv("SCHOLIA_TOKEN", "");

  await expect(resolveTarget({ server: "https://scholia.example", site: "docs" })).rejects.toThrow(
    /no token/,
  );
});

// A hosted Site has Viewers a directory of files does not, so the verbs that
// need one say which flag to pass rather than failing inside a 403.
test("a hosted verb that needs a Viewer names the flag", async () => {
  vi.stubEnv("SCHOLIA_VIEWER", "");
  const api = await resolveTarget({
    server: "https://scholia.example",
    site: "docs",
    token: "tok",
  });

  await expect(
    findVerb("edit_comment")!.run(api, { conversation: "c1", comment: "m1", body: "fixed" }),
  ).rejects.toThrow(/--viewer/);
});

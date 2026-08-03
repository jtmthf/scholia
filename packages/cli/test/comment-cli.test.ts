// The agent's half of the Conversation verb set (ADR-0021, ADR-0032).
//
// `scholia comments --json` is how an agent finds out what a Page says and gets
// the two ids every other command needs; the verbs are how it acts. These run
// against a real Sidecar in a real temp directory — the point of the CLI path is
// that it writes the same files the browser does, and a stubbed store would be
// asserting that the stub works.
//
// The cac wiring in cli.ts is deliberately not under test here: it is flag
// parsing, and these functions are what it calls.

import { expect, vi, beforeEach, afterEach } from "vitest";
import { test } from "./helpers/tmp.js";
import { SidecarStore } from "@scholia/sidecar";
import {
  commentCreate,
  commentDelete,
  commentEdit,
  commentList,
  commentReply,
  commentReact,
  conversationDelete,
  conversationPromote,
  conversationResolve,
} from "../src/comment-cli.js";

let logged: string[] = [];

beforeEach(() => {
  logged = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logged.push(args.join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface JsonComment {
  id: string;
  body: string;
  author: string;
  author_kind: "human" | "agent";
  deleted: boolean;
  edited_at: string | null;
  reactions: Array<{ emoji: string; authors: string[] }>;
}

interface JsonConversation {
  id: string;
  visibility: "public" | "private";
  resolved: boolean;
  resolved_by: string | null;
  comments: JsonComment[];
}

/** What `scholia comments --json` prints — the agent's view of a Page. */
async function listJson(root: string, page: string): Promise<JsonConversation[]> {
  logged = [];
  await commentList({ page, root, json: true });
  return JSON.parse(logged.join("\n")) as JsonConversation[];
}

/** Start a Conversation and hand back the ids the other commands need. */
async function seed(
  root: string,
  page: string,
  body: string,
): Promise<{ conversation: string; comment: string }> {
  await commentCreate({ page, body, root });
  const [conversation] = await listJson(root, page);
  return { conversation: conversation!.id, comment: conversation!.comments[0]!.id };
}

test("`comments --json` carries the folded state an agent has to act on", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const ids = await seed(tmp.root, "guide.md", "worth a look");

  const [conversation] = await listJson(tmp.root, "guide.md");
  expect(conversation!.resolved).toBe(false);
  expect(conversation!.resolved_by).toBeNull();
  expect(conversation!.comments[0]!.deleted).toBe(false);
  expect(conversation!.comments[0]!.edited_at).toBeNull();
  expect(conversation!.comments[0]!.reactions).toEqual([]);
  // Both ids are printed, because every other command names both.
  expect(conversation!.id).toBe(ids.conversation);
  expect(conversation!.comments[0]!.id).toBe(ids.comment);
});

test("resolve and reopen are events, and show in the listing", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const ids = await seed(tmp.root, "guide.md", "needs a fix");

  await conversationResolve({ conversation: ids.conversation, root: tmp.root }, true);

  let [conversation] = await listJson(tmp.root, "guide.md");
  expect(conversation!.resolved).toBe(true);
  expect(conversation!.resolved_by).toBeTruthy();

  await conversationResolve({ conversation: ids.conversation, root: tmp.root }, false);

  [conversation] = await listJson(tmp.root, "guide.md");
  expect(conversation!.resolved).toBe(false);
  expect(conversation!.resolved_by).toBeNull();
});

// The AC's "by humans and agents": an agent reacts through exactly this path,
// and the palette is closed for it too.
test("react adds a Reaction, and --remove takes it back", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const ids = await seed(tmp.root, "guide.md", "worth a look");
  const target = { conversation: ids.conversation, comment: ids.comment, root: tmp.root };

  await commentReact({ ...target, emoji: "👍" });

  let [conversation] = await listJson(tmp.root, "guide.md");
  expect(conversation!.comments[0]!.reactions).toHaveLength(1);
  expect(conversation!.comments[0]!.reactions[0]!.emoji).toBe("👍");

  await commentReact({ ...target, emoji: "👍", remove: true });

  [conversation] = await listJson(tmp.root, "guide.md");
  expect(conversation!.comments[0]!.reactions).toEqual([]);
});

// An agent that runs `react` twice means "make sure this is reacted", not
// "react then un-react" — so the CLI states the outcome it wants.
test("react twice is not a toggle back off", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const ids = await seed(tmp.root, "guide.md", "worth a look");
  const target = { conversation: ids.conversation, comment: ids.comment, root: tmp.root };

  await commentReact({ ...target, emoji: "✅" });
  await commentReact({ ...target, emoji: "✅" });

  const [conversation] = await listJson(tmp.root, "guide.md");
  expect(conversation!.comments[0]!.reactions).toEqual([
    { emoji: "✅", authors: expect.any(Array) },
  ]);
  expect(conversation!.comments[0]!.reactions[0]!.authors).toHaveLength(1);
});

test("an emoji outside the palette is refused", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const ids = await seed(tmp.root, "guide.md", "worth a look");

  await expect(
    commentReact({
      conversation: ids.conversation,
      comment: ids.comment,
      emoji: "🦖",
      root: tmp.root,
    }),
  ).rejects.toMatchObject({ code: "invalid" });
});

test("edit-comment rewrites the body and marks it edited", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const ids = await seed(tmp.root, "guide.md", "frist");

  await commentEdit({
    conversation: ids.conversation,
    comment: ids.comment,
    body: "first",
    root: tmp.root,
  });

  const [conversation] = await listJson(tmp.root, "guide.md");
  expect(conversation!.comments[0]!.body).toBe("first");
  expect(conversation!.comments[0]!.edited_at).toBeTruthy();
});

test("delete-comment leaves a tombstone", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const ids = await seed(tmp.root, "guide.md", "said in haste");

  await commentDelete({ conversation: ids.conversation, comment: ids.comment, root: tmp.root });

  const [conversation] = await listJson(tmp.root, "guide.md");
  expect(conversation!.comments[0]!.deleted).toBe(true);
  expect(conversation!.comments[0]!.body).toBe("");
});

// Whoever runs the CLI is the Owner — it is their filesystem — so this works
// without any extra flag, unlike the served path where a guest reaches the
// same routes.
test("delete-conversation takes it off the Page but leaves the file", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const ids = await seed(tmp.root, "guide.md", "off topic");

  await conversationDelete({ conversation: ids.conversation, root: tmp.root });

  expect(await listJson(tmp.root, "guide.md")).toEqual([]);

  // Still in the Sidecar, tombstoned rather than removed (ADR-0032).
  const store = new SidecarStore(tmp.root);
  const stored = await store.getConversation(ids.conversation);
  expect(stored!.deleted).toBe(true);
  expect(stored!.comments[0]!.body).toBe("off topic");
});

test("acting on a Conversation that is not there says so", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");

  await expect(
    conversationResolve(
      { conversation: "00000000-0000-7000-8000-000000000001", root: tmp.root },
      true,
    ),
  ).rejects.toMatchObject({ code: "not-found" });
});

test("the human listing shows resolve state, edits, tombstones and tallies", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const first = await seed(tmp.root, "guide.md", "keep this one");

  await commentEdit({
    conversation: first.conversation,
    comment: first.comment,
    body: "keep this one, edited",
    root: tmp.root,
  });
  await commentReact({
    conversation: first.conversation,
    comment: first.comment,
    emoji: "👍",
    root: tmp.root,
  });
  await conversationResolve({ conversation: first.conversation, root: tmp.root }, true);

  logged = [];
  await commentList({ page: "guide.md", root: tmp.root });
  const output = logged.join("\n");

  expect(output).toContain("resolved by");
  expect(output).toContain("keep this one, edited");
  expect(output).toContain("(edited)");
  expect(output).toContain("👍 1");
});

// ---- Private Chats and Promotion (issue #31) ----

test("`--chat` puts the Conversation in .scholia/chats", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  await commentCreate({ page: "guide.md", body: "private thought", root: tmp.root, chat: true });

  const [conversation] = await listJson(tmp.root, "guide.md");
  expect(conversation!.visibility).toBe("private");
  expect(conversation!.comments[0]!.body).toBe("private thought");

  // The human listing shows a lock for private Chats.
  logged = [];
  await commentList({ page: "guide.md", root: tmp.root });
  expect(logged.join("\n")).toContain("🔒");
});

test("`--agent` marks the Comment with an agent badge", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  await commentCreate({
    page: "guide.md",
    body: "agent analysis",
    root: tmp.root,
    agent: "Claude Code",
  });

  const [conversation] = await listJson(tmp.root, "guide.md");
  expect(conversation!.comments[0]!.author).toBe("Claude Code");
  expect(conversation!.comments[0]!.author_kind).toBe("agent");

  // The human listing shows "(agent)" next to the author.
  logged = [];
  await commentList({ page: "guide.md", root: tmp.root });
  expect(logged.join("\n")).toContain("(agent)");
});

test("`--agent` combined with `--chat` marks a private Chat comment as from an agent", async ({
  tmp,
}) => {
  await tmp.write("guide.md", "# Guide\n");
  await commentCreate({
    page: "guide.md",
    body: "private agent reply",
    root: tmp.root,
    chat: true,
    agent: "Claude Code",
  });

  const [conversation] = await listJson(tmp.root, "guide.md");
  expect(conversation!.visibility).toBe("private");
  expect(conversation!.comments[0]!.author_kind).toBe("agent");
});

test("an agent can reply to a Chat", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  await commentCreate({
    page: "guide.md",
    body: "question for my agent",
    root: tmp.root,
    chat: true,
  });

  const [chat] = await listJson(tmp.root, "guide.md");
  await commentReply({
    conversation: chat!.id,
    body: "here is the answer",
    root: tmp.root,
    agent: "Claude Code",
  });

  const [updated] = await listJson(tmp.root, "guide.md");
  expect(updated!.comments).toHaveLength(2);
  expect(updated!.comments[1]!.body).toBe("here is the answer");
  expect(updated!.comments[1]!.author_kind).toBe("agent");
});

test("promote writes a public Thread from a Chat without touching it", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  await commentCreate({ page: "guide.md", body: "first message", root: tmp.root, chat: true });
  await commentCreate({ page: "guide.md", body: "unrelated public", root: tmp.root });

  let conversations = await listJson(tmp.root, "guide.md");
  const chat = conversations.find((c) => c.visibility === "private")!;

  await conversationPromote({
    conversation: chat.id,
    comments: [chat.comments[0]!.id],
    summary: "Worth raising.",
    root: tmp.root,
  });

  conversations = await listJson(tmp.root, "guide.md");
  // Original Chat still there, still private.
  const stillChat = conversations.find((c) => c.visibility === "private")!;
  expect(stillChat.id).toBe(chat.id);
  expect(stillChat.comments).toHaveLength(1);

  // A new public Thread appeared.
  const threads = conversations.filter((c) => c.visibility === "public");
  expect(threads).toHaveLength(2); // original unrelated + promoted
  const promoted = threads.find((c) => c.id !== chat.id && c.id !== conversations[0]!.id)!;
  expect(promoted.comments.map((c) => c.body)).toEqual(["first message", "Worth raising."]);
});

test("refuses to promote something that does not exist", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");

  await expect(
    conversationPromote({
      conversation: "00000000-0000-7000-8000-0000000000ff",
      comments: [],
      root: tmp.root,
    }),
  ).rejects.toMatchObject({ code: "not-found" });
});

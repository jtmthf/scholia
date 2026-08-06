// The agent's half of the Conversation verb set, driven the way both surfaces
// drive it (ADR-0021, ADR-0032).
//
// These call `verb.run(api, input)` — the one path the CLI action and the MCP
// tool handler both go through — against a real Sidecar in a real temp
// directory. The point of the local target is that it writes the same files the
// browser does, so a stubbed store would be asserting that the stub works.
//
// The flag parsing in cli.ts and the tool wiring in mcp.ts are asserted in
// parity.test.ts; what a verb *does* is here.

import { expect } from "vitest";
import { test } from "./helpers/tmp.js";
import { findVerb, type ConversationApi, type ConversationView } from "@scholia/core";
import { createLocalApi, SidecarStore } from "@scholia/sidecar";

/** Run a verb the way a surface does: by name, with a loose input bag. */
async function run(
  api: ConversationApi,
  name: string,
  input: Record<string, unknown>,
): Promise<{ data: unknown; lines: string[] }> {
  const verb = findVerb(name);
  if (!verb) throw new Error(`no verb ${name}`);
  return verb.run(api, input);
}

async function listing(
  api: ConversationApi,
  input: Record<string, unknown> = {},
): Promise<ConversationView[]> {
  const { data } = await run(api, "list_conversations", input);
  return data as ConversationView[];
}

/** Start a Conversation and hand back the ids the other verbs need. */
async function seed(
  api: ConversationApi,
  page: string,
  body: string,
  extra: Record<string, unknown> = {},
): Promise<{ conversation: string; comment: string }> {
  const { data } = await run(api, "comment", { page, body, ...extra });
  const conversation = data as ConversationView;
  return { conversation: conversation.id, comment: conversation.comments[0]!.id };
}

test("list_conversations carries the folded state an agent has to act on", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const api = createLocalApi({ rootDir: tmp.root });
  const ids = await seed(api, "guide.md", "worth a look");

  const [conversation] = await listing(api, { page: "guide.md" });
  expect(conversation!.resolved).toBe(false);
  expect(conversation!.resolved_by).toBeNull();
  expect(conversation!.comments[0]!.deleted).toBe(false);
  expect(conversation!.comments[0]!.edited_at).toBeNull();
  expect(conversation!.comments[0]!.reactions).toEqual([]);
  // Both ids are in the answer, because every other verb names both.
  expect(conversation!.id).toBe(ids.conversation);
  expect(conversation!.comments[0]!.id).toBe(ids.comment);
});

test("resolve and reopen are events, and show in the listing", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const api = createLocalApi({ rootDir: tmp.root });
  const ids = await seed(api, "guide.md", "needs a fix");

  await run(api, "resolve", { conversation: ids.conversation });

  let [conversation] = await listing(api, { page: "guide.md" });
  expect(conversation!.resolved).toBe(true);
  expect(conversation!.resolved_by).toBeTruthy();

  await run(api, "reopen", { conversation: ids.conversation });

  [conversation] = await listing(api, { page: "guide.md" });
  expect(conversation!.resolved).toBe(false);
  expect(conversation!.resolved_by).toBeNull();
});

// The AC's "by humans and agents": an agent reacts through exactly this path,
// and the palette is closed for it too.
test("react adds a Reaction, and --remove takes it back", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const api = createLocalApi({ rootDir: tmp.root });
  const ids = await seed(api, "guide.md", "worth a look");
  const target = { conversation: ids.conversation, comment: ids.comment };

  await run(api, "react", { ...target, emoji: "👍" });

  let [conversation] = await listing(api, { page: "guide.md" });
  expect(conversation!.comments[0]!.reactions).toHaveLength(1);
  expect(conversation!.comments[0]!.reactions[0]!.emoji).toBe("👍");

  await run(api, "react", { ...target, emoji: "👍", remove: true });

  [conversation] = await listing(api, { page: "guide.md" });
  expect(conversation!.comments[0]!.reactions).toEqual([]);
});

// An agent that reacts twice means "make sure this is reacted", not "react then
// un-react" — so the verb states the outcome it wants.
test("react twice is not a toggle back off", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const api = createLocalApi({ rootDir: tmp.root });
  const ids = await seed(api, "guide.md", "worth a look");
  const target = { conversation: ids.conversation, comment: ids.comment, emoji: "✅" };

  await run(api, "react", target);
  await run(api, "react", target);

  const [conversation] = await listing(api, { page: "guide.md" });
  expect(conversation!.comments[0]!.reactions).toHaveLength(1);
  expect(conversation!.comments[0]!.reactions[0]!.authors).toHaveLength(1);
});

test("an emoji outside the palette is refused", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const api = createLocalApi({ rootDir: tmp.root });
  const ids = await seed(api, "guide.md", "worth a look");

  await expect(
    run(api, "react", { conversation: ids.conversation, comment: ids.comment, emoji: "🦖" }),
  ).rejects.toMatchObject({ code: "invalid" });
});

test("edit_comment rewrites the body and marks it edited", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const api = createLocalApi({ rootDir: tmp.root });
  const ids = await seed(api, "guide.md", "frist");

  await run(api, "edit_comment", {
    conversation: ids.conversation,
    comment: ids.comment,
    body: "first",
  });

  const [conversation] = await listing(api, { page: "guide.md" });
  expect(conversation!.comments[0]!.body).toBe("first");
  expect(conversation!.comments[0]!.edited_at).toBeTruthy();
});

test("delete_comment leaves a tombstone", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const api = createLocalApi({ rootDir: tmp.root });
  const ids = await seed(api, "guide.md", "said in haste");

  await run(api, "delete_comment", { conversation: ids.conversation, comment: ids.comment });

  const [conversation] = await listing(api, { page: "guide.md" });
  expect(conversation!.comments[0]!.deleted).toBe(true);
  expect(conversation!.comments[0]!.body).toBe("");
});

// Whoever runs this is the Owner — it is their filesystem — so it works without
// any extra flag, unlike the served path where a guest reaches the same verbs.
test("delete_conversation takes it off the Page but leaves the file", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const api = createLocalApi({ rootDir: tmp.root });
  const ids = await seed(api, "guide.md", "off topic");

  await run(api, "delete_conversation", { conversation: ids.conversation });

  expect(await listing(api, { page: "guide.md" })).toEqual([]);

  // Still in the Sidecar, tombstoned rather than removed (ADR-0032).
  const store = new SidecarStore(tmp.root);
  const stored = await store.getConversation(ids.conversation);
  expect(stored!.deleted).toBe(true);
  expect(stored!.comments[0]!.body).toBe("off topic");
});

test("acting on a Conversation that is not there says so", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const api = createLocalApi({ rootDir: tmp.root });

  await expect(
    run(api, "resolve", { conversation: "00000000-0000-7000-8000-000000000001" }),
  ).rejects.toMatchObject({ code: "not-found" });
});

test("a required param missing is reported as the flag whoever typed it left out", async ({
  tmp,
}) => {
  const api = createLocalApi({ rootDir: tmp.root });

  await expect(run(api, "reply", { body: "no target" })).rejects.toThrow(
    "--conversation is required",
  );
});

test("the human lines show resolve state, edits, tombstones and tallies", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const api = createLocalApi({ rootDir: tmp.root });
  const first = await seed(api, "guide.md", "keep this one");

  await run(api, "edit_comment", {
    conversation: first.conversation,
    comment: first.comment,
    body: "keep this one, edited",
  });
  await run(api, "react", {
    conversation: first.conversation,
    comment: first.comment,
    emoji: "👍",
  });
  await run(api, "resolve", { conversation: first.conversation });

  const { lines } = await run(api, "list_conversations", { page: "guide.md" });
  const output = lines.join("\n");

  expect(output).toContain("resolved by");
  expect(output).toContain("keep this one, edited");
  expect(output).toContain("(edited)");
  expect(output).toContain("👍 1");
});

// ---- Private Chats and Promotion (issue #31) ----

test("`--chat` puts the Conversation in .scholia/chats", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const api = createLocalApi({ rootDir: tmp.root });
  await run(api, "comment", { page: "guide.md", body: "private thought", chat: true });

  const [conversation] = await listing(api, { page: "guide.md" });
  expect(conversation!.visibility).toBe("private");
  expect(conversation!.comments[0]!.body).toBe("private thought");

  // The human listing shows a lock for private Chats.
  const { lines } = await run(api, "list_conversations", { page: "guide.md" });
  expect(lines.join("\n")).toContain("🔒");
});

test("`--agent` marks the Comment with an agent badge", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const api = createLocalApi({ rootDir: tmp.root });
  await run(api, "comment", { page: "guide.md", body: "agent analysis", agent: "Claude Code" });

  const [conversation] = await listing(api, { page: "guide.md" });
  expect(conversation!.comments[0]!.author).toBe("Claude Code");
  expect(conversation!.comments[0]!.author_kind).toBe("agent");

  const { lines } = await run(api, "list_conversations", { page: "guide.md" });
  expect(lines.join("\n")).toContain("(agent)");
});

test("`--agent` combined with `--chat` marks a private Chat comment as from an agent", async ({
  tmp,
}) => {
  await tmp.write("guide.md", "# Guide\n");
  const api = createLocalApi({ rootDir: tmp.root });
  await run(api, "comment", {
    page: "guide.md",
    body: "private agent reply",
    chat: true,
    agent: "Claude Code",
  });

  const [conversation] = await listing(api, { page: "guide.md" });
  expect(conversation!.visibility).toBe("private");
  expect(conversation!.comments[0]!.author_kind).toBe("agent");
});

test("an agent can reply to a Chat", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const api = createLocalApi({ rootDir: tmp.root });
  const chat = await seed(api, "guide.md", "question for my agent", { chat: true });

  await run(api, "reply", {
    conversation: chat.conversation,
    body: "here is the answer",
    agent: "Claude Code",
  });

  const [updated] = await listing(api, { page: "guide.md" });
  expect(updated!.comments).toHaveLength(2);
  expect(updated!.comments[1]!.body).toBe("here is the answer");
  expect(updated!.comments[1]!.author_kind).toBe("agent");
});

test("list_chats returns only the private Conversations", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const api = createLocalApi({ rootDir: tmp.root });
  await run(api, "comment", { page: "guide.md", body: "public one" });
  await run(api, "comment", { page: "guide.md", body: "private one", chat: true });

  const { data } = await run(api, "list_chats", { page: "guide.md" });
  const chats = data as ConversationView[];
  expect(chats).toHaveLength(1);
  expect(chats[0]!.visibility).toBe("private");
  expect(chats[0]!.comments[0]!.body).toBe("private one");
});

test("promote writes a public Thread from a Chat without touching it", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const api = createLocalApi({ rootDir: tmp.root });
  const chat = await seed(api, "guide.md", "first message", { chat: true });
  await run(api, "comment", { page: "guide.md", body: "unrelated public" });

  await run(api, "promote", {
    conversation: chat.conversation,
    comment: [chat.comment],
    summary: "Worth raising.",
  });

  const conversations = await listing(api, { page: "guide.md" });
  // Original Chat still there, still private.
  const stillChat = conversations.find((c) => c.visibility === "private")!;
  expect(stillChat.id).toBe(chat.conversation);
  expect(stillChat.comments).toHaveLength(1);

  const threads = conversations.filter((c) => c.visibility === "public");
  expect(threads).toHaveLength(2); // the unrelated one + the promoted one
  const promoted = threads.find((c) => c.comments.length === 2)!;
  expect(promoted.comments.map((c) => c.body)).toEqual(["first message", "Worth raising."]);
});

test("refuses to promote something that does not exist", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const api = createLocalApi({ rootDir: tmp.root });

  await expect(
    run(api, "promote", {
      conversation: "00000000-0000-7000-8000-0000000000ff",
      comment: ["00000000-0000-7000-8000-0000000000fe"],
    }),
  ).rejects.toMatchObject({ code: "not-found" });
});

// Promoting nothing would write an empty Thread, so the verb asks for at least
// one Comment rather than quietly producing one.
test("promote needs at least one Comment", async ({ tmp }) => {
  const api = createLocalApi({ rootDir: tmp.root });

  await expect(
    run(api, "promote", { conversation: "00000000-0000-7000-8000-0000000000ff", comment: [] }),
  ).rejects.toThrow("--comment is required");
});

// ---- The filters both surfaces carry (issue #34) ----

test("no page lists every Page, and a page narrows to it", async ({ tmp }) => {
  await tmp.write("a.md", "# A\n");
  await tmp.write("b.md", "# B\n");
  const api = createLocalApi({ rootDir: tmp.root });
  await seed(api, "a.md", "on a");
  await seed(api, "b.md", "on b");

  expect(await listing(api)).toHaveLength(2);
  expect(await listing(api, { page: "a.md" })).toHaveLength(1);
});

test("--unresolved drops the ones somebody settled", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const api = createLocalApi({ rootDir: tmp.root });
  const settled = await seed(api, "guide.md", "already handled");
  await seed(api, "guide.md", "still open");
  await run(api, "resolve", { conversation: settled.conversation });

  const open = await listing(api, { unresolved: true });
  expect(open).toHaveLength(1);
  expect(open[0]!.comments[0]!.body).toBe("still open");
});

test("--since is activity, so a reply brings an old Conversation back", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const api = createLocalApi({ rootDir: tmp.root });
  const old = await seed(api, "guide.md", "from before");

  const mark = new Date().toISOString();
  await new Promise((r) => setTimeout(r, 2));
  expect(await listing(api, { since: mark })).toHaveLength(0);

  await run(api, "reply", { conversation: old.conversation, body: "and now this" });
  expect(await listing(api, { since: mark })).toHaveLength(1);
});

test("--mentions finds the Conversations addressed to you", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const api = createLocalApi({ rootDir: tmp.root });
  await seed(api, "guide.md", "@claude-code can you look at this");
  await seed(api, "guide.md", "nothing to do with anyone");

  // Slug-tolerant, so the name an agent knows itself by finds the handle a
  // human typed.
  const mine = await listing(api, { mentions: "Claude Code" });
  expect(mine).toHaveLength(1);
  expect(mine[0]!.comments[0]!.body).toContain("@claude-code");
});

test("the filters compose", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const api = createLocalApi({ rootDir: tmp.root });
  const settled = await seed(api, "guide.md", "@claude-code handled already");
  await seed(api, "guide.md", "@claude-code still needs you");
  await run(api, "resolve", { conversation: settled.conversation });

  const todo = await listing(api, { page: "guide.md", unresolved: true, mentions: "claude-code" });
  expect(todo).toHaveLength(1);
  expect(todo[0]!.comments[0]!.body).toBe("@claude-code still needs you");
});

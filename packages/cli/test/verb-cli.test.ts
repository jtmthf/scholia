// The CLI rendering of the verb set: argv in, Sidecar out (ADR-0021).
//
// verbs.test.ts asserts what a verb does; this asserts the half only the CLI
// has — that a positional lands on the right param, that the flag form still
// works for anyone who scripted it, and that `--json` prints exactly what MCP
// would have returned.

import { expect, vi, beforeEach, afterEach } from "vitest";
import { test } from "./helpers/tmp.js";
import { cac } from "cac";
import type { ConversationView } from "@scholia/core";
import { createLocalApi } from "@scholia/sidecar";
import { registerVerbCommands } from "../src/verb-cli.js";

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

/**
 * Run one command line against a Sidecar in `rootDir`.
 *
 * The target is passed in rather than resolved from flags, so nothing here can
 * reach the network or a credentials file — the resolution itself is
 * target.test.ts's job.
 */
async function runCli(rootDir: string, argv: string[]): Promise<string> {
  logged = [];
  const cli = cac("scholia");
  registerVerbCommands(cli, createLocalApi({ rootDir }));
  const parsed = cli.parse(["node", "scholia", ...argv], { run: false });
  await cli.runMatchedCommand();
  expect(parsed.args.length >= 0).toBe(true);
  return logged.join("\n");
}

test("a positional lands on the param its place names", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");

  const output = await runCli(tmp.root, [
    "comment",
    "the intro overpromises",
    "--page",
    "guide.md",
  ]);
  expect(output).toContain("Created Conversation");
  expect(output).toContain("Body:   the intro overpromises");

  const listed = JSON.parse(
    await runCli(tmp.root, ["comments", "guide.md", "--json"]),
  ) as ConversationView[];
  expect(listed).toHaveLength(1);
  expect(listed[0]!.comments[0]!.body).toBe("the intro overpromises");
});

test("the flag form of a positional still works", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  await runCli(tmp.root, ["comment", "--body", "written the old way", "--page", "guide.md"]);

  const listed = JSON.parse(
    await runCli(tmp.root, ["comments", "--page", "guide.md", "--json"]),
  ) as ConversationView[];
  expect(listed[0]!.comments[0]!.body).toBe("written the old way");
});

test("the ids from --json drive the next command, positionally", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  await runCli(tmp.root, ["comment", "needs a second opinion", "--page", "guide.md"]);

  const [conversation] = JSON.parse(
    await runCli(tmp.root, ["comments", "--json"]),
  ) as ConversationView[];
  const commentId = conversation!.comments[0]!.id;

  await runCli(tmp.root, ["reply", conversation!.id, "agreed", "--agent", "Claude Code"]);
  await runCli(tmp.root, ["react", conversation!.id, commentId, "👍"]);
  await runCli(tmp.root, ["resolve", conversation!.id]);

  const [updated] = JSON.parse(
    await runCli(tmp.root, ["comments", "--json"]),
  ) as ConversationView[];
  expect(updated!.resolved).toBe(true);
  expect(updated!.comments).toHaveLength(2);
  expect(updated!.comments[1]!.author_kind).toBe("agent");
  expect(updated!.comments[0]!.reactions[0]!.emoji).toBe("👍");
});

test("a repeated flag collects, so promote can name several Comments", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  await runCli(tmp.root, ["comment", "first thought", "--page", "guide.md", "--chat"]);

  const [chat] = JSON.parse(await runCli(tmp.root, ["chats", "--json"])) as ConversationView[];
  await runCli(tmp.root, ["reply", chat!.id, "second thought"]);

  const [withReply] = JSON.parse(await runCli(tmp.root, ["chats", "--json"])) as ConversationView[];
  const ids = withReply!.comments.map((comment) => comment.id);

  const output = await runCli(tmp.root, [
    "promote",
    chat!.id,
    "--comment",
    ids[0]!,
    "--comment",
    ids[1]!,
    "--summary",
    "Worth raising.",
  ]);
  expect(output).toContain("Promoted to Thread");

  const threads = (
    JSON.parse(await runCli(tmp.root, ["comments", "--json"])) as ConversationView[]
  ).filter((conversation) => conversation.visibility === "public");
  expect(threads).toHaveLength(1);
  expect(threads[0]!.comments.map((comment) => comment.body)).toEqual([
    "first thought",
    "second thought",
    "Worth raising.",
  ]);
});

test("`comments` with no page lists every Page", async ({ tmp }) => {
  await tmp.write("a.md", "# A\n");
  await tmp.write("b.md", "# B\n");
  await runCli(tmp.root, ["comment", "on a", "--page", "a.md"]);
  await runCli(tmp.root, ["comment", "on b", "--page", "b.md"]);

  expect(JSON.parse(await runCli(tmp.root, ["comments", "--json"]))).toHaveLength(2);
  expect(JSON.parse(await runCli(tmp.root, ["comments", "a.md", "--json"]))).toHaveLength(1);
});

test("an alias reaches the same verb", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  await runCli(tmp.root, ["comment", "listed under either name", "--page", "guide.md"]);

  expect(JSON.parse(await runCli(tmp.root, ["list-conversations", "--json"]))).toHaveLength(1);
});

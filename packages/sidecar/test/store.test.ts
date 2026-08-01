// Sidecar adapter integration tests: YAML round-trip, fold dedup, page
// filtering, body escaping, and the .gitignore self-ignore convention.
//
// Uses real filesystem ops against temp directories (like the rest of the
// test suite) — no mocking of read/write, because getting the YAML stream
// format right is the whole point of this adapter.

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SidecarStore } from "../src/store.js";
import type { Anchor, ConversationEvent } from "@scholia/core";

describe("SidecarStore", () => {
  let rootDir: string;
  let store: SidecarStore;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "scholia-sidecar-test-"));
    store = new SidecarStore(rootDir);
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  const anchor: Anchor = {
    textQuote: { exact: "hello world", prefix: "say ", suffix: " loudly" },
    sourceRange: { start: 0, end: 11 },
  };

  // ---- createConversation ----

  test("createConversation writes a YAML file and round-trips exactly", async () => {
    const result = await store.createConversation({
      header: {
        id: "00000000-0000-7000-8000-000000000001",
        page: "docs/guide.md",
        anchor,
        author: "alice",
        timestamp: "2025-01-15T12:00:00.000Z",
      },
      firstComment: {
        id: "00000000-0000-7000-8000-000000000002",
        type: "comment",
        timestamp: "2025-01-15T12:00:00.000Z",
        author: "alice",
        body: "This looks great.",
      },
    });

    expect(result.header.id).toBe("00000000-0000-7000-8000-000000000001");
    expect(result.header.page).toBe("docs/guide.md");
    expect(result.header.author).toBe("alice");
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]!.body).toBe("This looks great.");

    // The file should exist at the expected path.
    const filePath = join(
      rootDir,
      ".scholia",
      "conversations",
      "00000000-0000-7000-8000-000000000001.yaml",
    );
    const raw = await readFile(filePath, "utf8");
    expect(raw).toContain("id: 00000000-0000-7000-8000-000000000001");
    expect(raw).toContain("body:");
    expect(raw).toContain("This looks great.");
  });

  test("createConversation creates a self-ignoring .gitignore", async () => {
    await store.createConversation({
      header: {
        id: "00000000-0000-7000-8000-000000000003",
        page: "readme.md",
        anchor: null,
        author: "bob",
        timestamp: "2025-01-15T12:00:00.000Z",
      },
      firstComment: {
        id: "00000000-0000-7000-8000-000000000004",
        type: "comment",
        timestamp: "2025-01-15T12:00:00.000Z",
        author: "bob",
        body: "ok",
      },
    });

    const gitignore = await readFile(join(rootDir, ".scholia", ".gitignore"), "utf8");
    expect(gitignore.trim()).toBe("*");
  });

  test("bodies containing YAML special characters round-trip exactly", async () => {
    const body = [
      "Here is a markdown code block:",
      "```yaml",
      "---",
      "key: value",
      "```",
      "And some --- dashes in text.",
    ].join("\n");

    await store.createConversation({
      header: {
        id: "00000000-0000-7000-8000-000000000005",
        page: "readme.md",
        anchor: null,
        author: "carol",
        timestamp: "2025-01-15T12:00:00.000Z",
      },
      firstComment: {
        id: "00000000-0000-7000-8000-000000000006",
        type: "comment",
        timestamp: "2025-01-15T12:00:00.000Z",
        author: "carol",
        body,
      },
    });

    const conversations = await store.listConversations("readme.md");
    expect(conversations).toHaveLength(1);
    expect(conversations[0]!.comments[0]!.body).toBe(body);
  });

  test("bodies containing YAML block scalar indicators round-trip exactly", async () => {
    const body = "  | this looks like a block scalar indicator\n  > and this looks like folded";

    await store.createConversation({
      header: {
        id: "00000000-0000-7000-8000-000000000007",
        page: "readme.md",
        anchor: null,
        author: "dave",
        timestamp: "2025-01-15T12:00:00.000Z",
      },
      firstComment: {
        id: "00000000-0000-7000-8000-000000000008",
        type: "comment",
        timestamp: "2025-01-15T12:00:00.000Z",
        author: "dave",
        body,
      },
    });

    const conversations = await store.listConversations("readme.md");
    expect(conversations).toHaveLength(1);
    expect(conversations[0]!.comments[0]!.body).toBe(body);
  });

  // ---- listConversations ----

  test("listConversations returns empty for a page with no Conversations", async () => {
    const result = await store.listConversations("nonexistent.md");
    expect(result).toEqual([]);
  });

  test("listConversations filters by page path", async () => {
    // Create a Conversation on page A.
    await store.createConversation({
      header: {
        id: "00000000-0000-7000-8000-00000000000a",
        page: "docs/a.md",
        anchor: null,
        author: "x",
        timestamp: "2025-01-15T12:00:00.000Z",
      },
      firstComment: {
        id: "00000000-0000-7000-8000-00000000000b",
        type: "comment",
        timestamp: "2025-01-15T12:00:00.000Z",
        author: "x",
        body: "comment on A",
      },
    });

    // Create another on page B.
    await store.createConversation({
      header: {
        id: "00000000-0000-7000-8000-00000000000c",
        page: "docs/b.md",
        anchor: null,
        author: "y",
        timestamp: "2025-01-15T12:00:00.000Z",
      },
      firstComment: {
        id: "00000000-0000-7000-8000-00000000000d",
        type: "comment",
        timestamp: "2025-01-15T12:00:00.000Z",
        author: "y",
        body: "comment on B",
      },
    });

    const aResults = await store.listConversations("docs/a.md");
    expect(aResults).toHaveLength(1);
    expect(aResults[0]!.header.page).toBe("docs/a.md");

    const bResults = await store.listConversations("docs/b.md");
    expect(bResults).toHaveLength(1);
    expect(bResults[0]!.header.page).toBe("docs/b.md");
  });

  test("listConversations returns an empty Conversations dir cleanly (no error)", async () => {
    // Ensure the dir exists but is empty — this must not throw.
    await store.createConversation({
      header: {
        id: "00000000-0000-7000-8000-00000000000e",
        page: "temp.md",
        anchor: null,
        author: "z",
        timestamp: "2025-01-15T12:00:00.000Z",
      },
      firstComment: {
        id: "00000000-0000-7000-8000-00000000000f",
        type: "comment",
        timestamp: "2025-01-15T12:00:00.000Z",
        author: "z",
        body: "temp",
      },
    });

    // Calling for a different page — should be empty, no error.
    const result = await store.listConversations("other.md");
    expect(result).toEqual([]);
  });

  // ---- Anchor round-trip ----

  test("round-trips a full Anchor with textQuote and sourceRange", async () => {
    const fullAnchor: Anchor = {
      textQuote: {
        exact: "target text",
        prefix: "before",
        suffix: "after",
      },
      sourceRange: { start: 42, end: 53 },
    };

    await store.createConversation({
      header: {
        id: "00000000-0000-7000-8000-000000000010",
        page: "readme.md",
        anchor: fullAnchor,
        author: "eve",
        timestamp: "2025-01-15T12:00:00.000Z",
      },
      firstComment: {
        id: "00000000-0000-7000-8000-000000000011",
        type: "comment",
        timestamp: "2025-01-15T12:00:00.000Z",
        author: "eve",
        body: "anchored",
      },
    });

    const results = await store.listConversations("readme.md");
    expect(results).toHaveLength(1);
    expect(results[0]!.header.anchor).toEqual(fullAnchor);
  });

  test("round-trips a null anchor (page-level Conversation)", async () => {
    await store.createConversation({
      header: {
        id: "00000000-0000-7000-8000-000000000012",
        page: "readme.md",
        anchor: null,
        author: "frank",
        timestamp: "2025-01-15T12:00:00.000Z",
      },
      firstComment: {
        id: "00000000-0000-7000-8000-000000000013",
        type: "comment",
        timestamp: "2025-01-15T12:00:00.000Z",
        author: "frank",
        body: "no anchor",
      },
    });

    const results = await store.listConversations("readme.md");
    expect(results).toHaveLength(1);
    expect(results[0]!.header.anchor).toBeNull();
  });

  // ---- Dedup by event id ----

  test("fold dedupes duplicate events by id", async () => {
    // Write a file with duplicate event ids (simulating union merge).
    const filePath = join(rootDir, ".scholia", "conversations");
    await mkdir(filePath, { recursive: true });

    // A file with the same event id appearing twice (union merge scenario).
    const raw = [
      "---",
      "id: 00000000-0000-7000-8000-000000000014",
      "page: readme.md",
      "anchor: null",
      "author: grace",
      "timestamp: '2025-01-15T12:00:00.000Z'",
      "---",
      "id: 00000000-0000-7000-8000-000000000015",
      "type: comment",
      "timestamp: '2025-01-15T12:00:00.000Z'",
      "author: grace",
      "body: |",
      "  first occurrence",
      "---",
      "id: 00000000-0000-7000-8000-000000000015",
      "type: comment",
      "timestamp: '2025-01-15T12:00:00.000Z'",
      "author: grace",
      "body: |",
      "  duplicate — should be ignored",
      "",
    ].join("\n");

    await writeFile(join(filePath, "dup.yaml"), raw);

    const results = await store.listConversations("readme.md");
    expect(results).toHaveLength(1);
    expect(results[0]!.comments).toHaveLength(1);
    // Must keep the first occurrence.
    expect(results[0]!.comments[0]!.body).toBe("first occurrence\n");
  });

  // ---- The Comment's binding (CONTEXT "Comment", ADR-0018) ----

  test("round-trips the content hash and Provenance recorded on the header", async () => {
    await store.createConversation({
      header: {
        id: "00000000-0000-7000-8000-00000000001a",
        page: "readme.md",
        anchor: null,
        contentHash: "a".repeat(64),
        provenance: { sha: "0123456789abcdef", branch: "main", dirty: true },
        author: "ivan",
        timestamp: "2025-01-15T12:00:00.000Z",
      },
      firstComment: {
        id: "00000000-0000-7000-8000-00000000001b",
        type: "comment",
        timestamp: "2025-01-15T12:00:00.000Z",
        author: "ivan",
        body: "bound",
      },
    });

    const [conversation] = await store.listConversations("readme.md");
    expect(conversation!.header.contentHash).toBe("a".repeat(64));
    expect(conversation!.header.provenance).toEqual({
      sha: "0123456789abcdef",
      branch: "main",
      dirty: true,
    });
  });

  test("omits contentHash and provenance entirely when there are none", async () => {
    await store.createConversation({
      header: {
        id: "00000000-0000-7000-8000-00000000001c",
        page: "readme.md",
        anchor: null,
        author: "judy",
        timestamp: "2025-01-15T12:00:00.000Z",
      },
      firstComment: {
        id: "00000000-0000-7000-8000-00000000001d",
        type: "comment",
        timestamp: "2025-01-15T12:00:00.000Z",
        author: "judy",
        body: "unbound",
      },
    });

    const raw = await readFile(
      join(rootDir, ".scholia", "conversations", "00000000-0000-7000-8000-00000000001c.yaml"),
      "utf8",
    );
    expect(raw).not.toContain("contentHash");
    expect(raw).not.toContain("provenance");
  });

  // ---- appendEvent ----

  async function seedConversation(id: string, commentId: string): Promise<void> {
    await store.createConversation({
      header: {
        id,
        page: "readme.md",
        anchor: null,
        author: "mallory",
        timestamp: "2025-01-15T12:00:00.000Z",
      },
      firstComment: {
        id: commentId,
        type: "comment",
        timestamp: "2025-01-15T12:00:00.000Z",
        author: "mallory",
        body: "first",
      },
    });
  }

  test("appendEvent adds a document without rewriting the ones before it", async () => {
    const id = "00000000-0000-7000-8000-000000000020";
    await seedConversation(id, "00000000-0000-7000-8000-000000000021");

    const filePath = join(rootDir, ".scholia", "conversations", `${id}.yaml`);
    const before = await readFile(filePath, "utf8");

    await store.appendEvent(id, {
      id: "00000000-0000-7000-8000-000000000022",
      type: "comment",
      timestamp: "2025-01-15T12:05:00.000Z",
      author: "trent",
      body: "a reply",
    });

    const after = await readFile(filePath, "utf8");
    expect(after.startsWith(before)).toBe(true);

    const [conversation] = await store.listConversations("readme.md");
    expect(conversation!.comments.map((c) => c.body)).toEqual(["first", "a reply"]);
    expect(conversation!.comments[1]!.author).toBe("trent");
  });

  test("appended bodies containing the document separator round-trip exactly", async () => {
    const id = "00000000-0000-7000-8000-000000000023";
    await seedConversation(id, "00000000-0000-7000-8000-000000000024");

    const body = "Look at this:\n---\nid: not-an-event\ntype: comment\n";
    await store.appendEvent(id, {
      id: "00000000-0000-7000-8000-000000000025",
      type: "comment",
      timestamp: "2025-01-15T12:05:00.000Z",
      author: "trent",
      body,
    });

    const [conversation] = await store.listConversations("readme.md");
    expect(conversation!.comments).toHaveLength(2);
    expect(conversation!.comments[1]!.body).toBe(body);
  });

  test("appendEvent rejects for a Conversation that does not exist", async () => {
    await expect(
      store.appendEvent("00000000-0000-7000-8000-000000000026", {
        id: "00000000-0000-7000-8000-000000000027",
        type: "comment",
        timestamp: "2025-01-15T12:05:00.000Z",
        author: "trent",
        body: "nowhere to go",
      }),
    ).rejects.toThrow(/no Conversation/);
  });

  // The id is also the filename, so a caller-supplied id has to be refused
  // before it reaches `join` rather than escaping the store's directory.
  test("appendEvent refuses an id that is not a UUID", async () => {
    await expect(
      store.appendEvent("../../escape", {
        id: "00000000-0000-7000-8000-000000000028",
        type: "comment",
        timestamp: "2025-01-15T12:05:00.000Z",
        author: "mallory",
        body: "traversal",
      }),
    ).rejects.toThrow(/not a Conversation id/);
  });

  test("comments fold in timestamp order regardless of file position", async () => {
    const convDir = join(rootDir, ".scholia", "conversations");
    await mkdir(convDir, { recursive: true });

    // What a union merge leaves behind: both sides' appends kept, in whatever
    // order git happened to interleave them.
    const raw = [
      "---",
      "id: 00000000-0000-7000-8000-000000000029",
      "page: readme.md",
      "anchor: null",
      "author: peggy",
      "timestamp: '2025-01-15T12:00:00.000Z'",
      "---",
      "id: 00000000-0000-7000-8000-00000000002b",
      "type: comment",
      "timestamp: '2025-01-15T12:09:00.000Z'",
      "author: peggy",
      "body: |",
      "  later",
      "---",
      "id: 00000000-0000-7000-8000-00000000002a",
      "type: comment",
      "timestamp: '2025-01-15T12:01:00.000Z'",
      "author: peggy",
      "body: |",
      "  earlier",
      "",
    ].join("\n");
    await writeFile(join(convDir, "merged.yaml"), raw);

    const [conversation] = await store.listConversations("readme.md");
    expect(conversation!.comments.map((c) => c.body)).toEqual(["earlier\n", "later\n"]);
  });

  // ---- Skipped non-.yaml files ----

  test("ignores non-.yaml files in the conversations directory", async () => {
    const convDir = join(rootDir, ".scholia", "conversations");
    await mkdir(convDir, { recursive: true });

    // Write a stray .txt file — must not crash listConversations.
    await writeFile(join(convDir, "notes.txt"), "not yaml");

    // Also create a valid Conversation.
    await store.createConversation({
      header: {
        id: "00000000-0000-7000-8000-000000000016",
        page: "readme.md",
        anchor: null,
        author: "heidi",
        timestamp: "2025-01-15T12:00:00.000Z",
      },
      firstComment: {
        id: "00000000-0000-7000-8000-000000000017",
        type: "comment",
        timestamp: "2025-01-15T12:00:00.000Z",
        author: "heidi",
        body: "valid",
      },
    });

    const results = await store.listConversations("readme.md");
    expect(results).toHaveLength(1);
  });

  // ---- The rest of the event set (ADR-0032) ----
  //
  // The store's claim about these is narrow and it is the whole point of the
  // adapter: each one is a document appended to the end, serialized so it folds
  // back to exactly what was written. What the events *mean* is core's fold,
  // tested there.

  test("every event kind is an append — the bytes before it never change", async () => {
    const id = "00000000-0000-7000-8000-000000000030";
    const commentId = "00000000-0000-7000-8000-000000000031";
    await seedConversation(id, commentId);

    const filePath = join(rootDir, ".scholia", "conversations", `${id}.yaml`);
    let before = await readFile(filePath, "utf8");

    const events: ConversationEvent[] = [
      {
        id: "00000000-0000-7000-8000-000000000032",
        type: "edited",
        timestamp: "2025-01-15T12:01:00.000Z",
        author: "mallory",
        target: commentId,
        body: "edited body",
      },
      {
        id: "00000000-0000-7000-8000-000000000033",
        type: "reacted",
        timestamp: "2025-01-15T12:02:00.000Z",
        author: "trent",
        target: commentId,
        emoji: "👍",
      },
      {
        id: "00000000-0000-7000-8000-000000000034",
        type: "unreacted",
        timestamp: "2025-01-15T12:03:00.000Z",
        author: "trent",
        target: commentId,
        emoji: "👍",
      },
      {
        id: "00000000-0000-7000-8000-000000000035",
        type: "resolved",
        timestamp: "2025-01-15T12:04:00.000Z",
        author: "trent",
      },
      {
        id: "00000000-0000-7000-8000-000000000036",
        type: "reopened",
        timestamp: "2025-01-15T12:05:00.000Z",
        author: "mallory",
      },
      {
        id: "00000000-0000-7000-8000-000000000037",
        type: "deleted",
        timestamp: "2025-01-15T12:06:00.000Z",
        author: "mallory",
        target: commentId,
      },
    ];

    for (const event of events) {
      await store.appendEvent(id, event);
      const after = await readFile(filePath, "utf8");
      expect(after.startsWith(before)).toBe(true);
      before = after;
    }

    const conversation = (await store.getConversation(id))!;
    expect(conversation.resolved).toBe(false);
    expect(conversation.comments[0]!.deleted).toBe(true);
  });

  test("an `edited` event round-trips into the folded body", async () => {
    const id = "00000000-0000-7000-8000-000000000038";
    const commentId = "00000000-0000-7000-8000-000000000039";
    await seedConversation(id, commentId);

    // A body carrying the document separator and YAML syntax, because an edit
    // has to escape exactly as well as the `comment` event it supersedes.
    const body = "Rewritten:\n---\ntype: comment\n";
    await store.appendEvent(id, {
      id: "00000000-0000-7000-8000-00000000003a",
      type: "edited",
      timestamp: "2025-01-15T12:05:00.000Z",
      author: "mallory",
      target: commentId,
      body,
    });

    const conversation = (await store.getConversation(id))!;
    expect(conversation.comments[0]!.body).toBe(body);
    expect(conversation.comments[0]!.editedAt).toBe("2025-01-15T12:05:00.000Z");
  });

  test("a reaction round-trips its emoji, and carries no body field", async () => {
    const id = "00000000-0000-7000-8000-00000000003b";
    const commentId = "00000000-0000-7000-8000-00000000003c";
    await seedConversation(id, commentId);

    await store.appendEvent(id, {
      id: "00000000-0000-7000-8000-00000000003d",
      type: "reacted",
      timestamp: "2025-01-15T12:05:00.000Z",
      author: "trent",
      target: commentId,
      emoji: "🎉",
    });

    const raw = await readFile(join(rootDir, ".scholia", "conversations", `${id}.yaml`), "utf8");
    const last = raw.split("---\n").at(-1)!;
    expect(last).toContain("emoji: 🎉");
    expect(last).not.toContain("body:");

    const conversation = (await store.getConversation(id))!;
    expect(conversation.comments[0]!.reactions).toEqual([{ emoji: "🎉", authors: ["trent"] }]);
  });

  test("an author whose name contains spaces keeps their own reaction", async () => {
    const id = "00000000-0000-7000-8000-00000000003e";
    const commentId = "00000000-0000-7000-8000-00000000003f";
    await seedConversation(id, commentId);

    await store.appendEvent(id, {
      id: "00000000-0000-7000-8000-000000000040",
      type: "reacted",
      timestamp: "2025-01-15T12:05:00.000Z",
      author: "Ada Lovelace",
      target: commentId,
      emoji: "👍",
    });
    await store.appendEvent(id, {
      id: "00000000-0000-7000-8000-000000000041",
      type: "reacted",
      timestamp: "2025-01-15T12:06:00.000Z",
      author: "Grace Hopper",
      target: commentId,
      emoji: "👍",
    });

    const conversation = (await store.getConversation(id))!;
    expect(conversation.comments[0]!.reactions).toEqual([
      { emoji: "👍", authors: ["Ada Lovelace", "Grace Hopper"] },
    ]);
  });

  // A committed Sidecar can be read by an older Scholia than the one that wrote
  // it. An event kind this version has no opinion about must not cost the reader
  // the whole Conversation.
  test("an unrecognised event kind is skipped, not fatal", async () => {
    const convDir = join(rootDir, ".scholia", "conversations");
    await mkdir(convDir, { recursive: true });

    const raw = [
      "---",
      "id: 00000000-0000-7000-8000-000000000042",
      "page: readme.md",
      "anchor: null",
      "author: peggy",
      "timestamp: '2025-01-15T12:00:00.000Z'",
      "---",
      "id: 00000000-0000-7000-8000-000000000043",
      "type: comment",
      "timestamp: '2025-01-15T12:00:00.000Z'",
      "author: peggy",
      "body: |",
      "  still readable",
      "---",
      "id: 00000000-0000-7000-8000-000000000044",
      "type: reanchored",
      "timestamp: '2025-01-15T12:01:00.000Z'",
      "author: peggy",
      "anchor: null",
      "",
    ].join("\n");
    await writeFile(join(convDir, "future.yaml"), raw);

    const [conversation] = await store.listConversations("readme.md");
    expect(conversation!.comments.map((c) => c.body)).toEqual(["still readable\n"]);
  });

  // ---- getConversation ----

  test("getConversation folds one stream by id", async () => {
    const id = "00000000-0000-7000-8000-000000000045";
    await seedConversation(id, "00000000-0000-7000-8000-000000000046");

    const conversation = await store.getConversation(id);
    expect(conversation!.header.id).toBe(id);
    expect(conversation!.comments[0]!.body).toBe("first");
  });

  // "Already gone" and "never existed" are different answers, and a command that
  // has to authorize needs to tell them apart.
  test("getConversation still returns a deleted Conversation, marked deleted", async () => {
    const id = "00000000-0000-7000-8000-000000000047";
    await seedConversation(id, "00000000-0000-7000-8000-000000000048");
    await store.appendEvent(id, {
      id: "00000000-0000-7000-8000-000000000049",
      type: "deleted",
      timestamp: "2025-01-15T12:05:00.000Z",
      author: "mallory",
      target: id,
    });

    const conversation = await store.getConversation(id);
    expect(conversation!.deleted).toBe(true);
    // The file is still there, with every document it ever had.
    const raw = await readFile(join(rootDir, ".scholia", "conversations", `${id}.yaml`), "utf8");
    expect(raw).toContain("first");

    // The store reports it; dropping it from a Page is core's rule, not the
    // adapter's (ADR-0032).
    expect(await store.listConversations("readme.md")).toHaveLength(1);
  });

  test("getConversation is null for an id nothing carries", async () => {
    expect(await store.getConversation("00000000-0000-7000-8000-00000000004a")).toBeNull();
  });

  test("getConversation refuses an id that is not a UUID", async () => {
    await expect(store.getConversation("../../escape")).rejects.toThrow(/not a Conversation id/);
  });
});

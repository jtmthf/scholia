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
import { SidecarStore } from "../src/sidecar.js";
import type { Anchor } from "@scholia/core";

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
    const filePath = join(rootDir, ".scholia", "conversations", "00000000-0000-7000-8000-000000000001.yaml");
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
});

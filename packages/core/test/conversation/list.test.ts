import { describe, test, expect } from "vitest";
import { listConversations, foldConversation } from "@scholia/core";
import { comment, makeHeader, stubRepo } from "./stub-repo.js";

describe("listConversations", () => {
  test("asks the port for the page it was given, and nothing else", async () => {
    const repo = stubRepo();
    repo.seed(makeHeader({ id: "00000000-0000-7000-8000-00000000c0a1", page: "readme.md" }), [
      comment("00000000-0000-7000-8000-000000000001", "alice", "hello"),
    ]);
    repo.seed(makeHeader({ id: "00000000-0000-7000-8000-00000000c0b1", page: "other.md" }), [
      comment("00000000-0000-7000-8000-000000000002", "bob", "elsewhere"),
    ]);

    const result = await listConversations(repo, "readme.md");

    expect(result).toHaveLength(1);
    expect(result[0]!.comments[0]!.body).toBe("hello");
  });

  test("returns empty array when no Conversations exist for the page", async () => {
    const repo = stubRepo();
    expect(await listConversations(repo, "nonexistent.md")).toEqual([]);
  });

  test("passes through multiple Conversations", async () => {
    const repo = stubRepo();
    repo.seed(makeHeader({ id: "00000000-0000-7000-8000-00000000c0a1", page: "guide.md" }), []);
    repo.seed(makeHeader({ id: "00000000-0000-7000-8000-00000000c0b1", page: "guide.md" }), []);

    expect(await listConversations(repo, "guide.md")).toHaveLength(2);
  });

  // A deleted Conversation is not on the Page any more — but the file is still
  // in the Sidecar, and the store still reports it (ADR-0032). Dropping it is
  // the domain's call, so it happens here rather than in the adapter.
  test("a deleted Conversation is not listed, though the store still reports it", async () => {
    const repo = stubRepo();
    const kept = makeHeader({ id: "00000000-0000-7000-8000-00000000c0a1", page: "guide.md" });
    const gone = makeHeader({ id: "00000000-0000-7000-8000-00000000c0b1", page: "guide.md" });
    repo.seed(kept, [comment("00000000-0000-7000-8000-000000000001", "alice", "stays")]);
    repo.seed(gone, [
      comment("00000000-0000-7000-8000-000000000002", "alice", "goes"),
      {
        id: "00000000-0000-7000-8000-000000000003",
        type: "deleted",
        timestamp: "2025-01-15T13:00:00.000Z",
        author: "alice",
        target: gone.id,
      },
    ]);

    expect(await repo.listConversations("guide.md")).toHaveLength(2);

    const listed = await listConversations(repo, "guide.md");
    expect(listed).toHaveLength(1);
    expect(listed[0]!.header.id).toBe(kept.id);
  });

  test("the folded Conversation carries its resolve state", async () => {
    const repo = stubRepo();
    const header = makeHeader({ page: "guide.md" });
    repo.seed(header, [
      comment("00000000-0000-7000-8000-000000000001", "alice", "needs a fix"),
      {
        id: "00000000-0000-7000-8000-000000000002",
        type: "resolved",
        timestamp: "2025-01-15T13:00:00.000Z",
        author: "bob",
      },
    ]);

    const [conversation] = await listConversations(repo, "guide.md");
    expect(conversation).toEqual(
      foldConversation(header, [
        comment("00000000-0000-7000-8000-000000000001", "alice", "needs a fix"),
        {
          id: "00000000-0000-7000-8000-000000000002",
          type: "resolved",
          timestamp: "2025-01-15T13:00:00.000Z",
          author: "bob",
        },
      ]),
    );
    expect(conversation!.resolvedBy).toBe("bob");
  });
});

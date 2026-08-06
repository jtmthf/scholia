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

  // The filters an agent carries on both surfaces (ADR-0021). They live here,
  // over the fold, because what "unresolved" and "mentions Jane" mean is a
  // domain question — the store's job is to report what the streams say.
  describe("filters", () => {
    /** Two Conversations on one Page: one resolved, one mentioning an agent. */
    function seeded() {
      const repo = stubRepo();
      const settled = makeHeader({ id: "00000000-0000-7000-8000-00000000c0a1", page: "guide.md" });
      const open = makeHeader({ id: "00000000-0000-7000-8000-00000000c0b1", page: "guide.md" });
      const elsewhere = makeHeader({
        id: "00000000-0000-7000-8000-00000000c0c1",
        page: "other.md",
      });

      repo.seed(settled, [
        comment("00000000-0000-7000-8000-000000000001", "alice", "@claude-code done?"),
        {
          id: "00000000-0000-7000-8000-000000000002",
          type: "resolved",
          timestamp: "2025-01-15T13:00:00.000Z",
          author: "alice",
        },
      ]);
      repo.seed(open, [
        comment(
          "00000000-0000-7000-8000-000000000003",
          "bob",
          "still open",
          "2025-02-01T09:00:00.000Z",
        ),
      ]);
      repo.seed(elsewhere, [comment("00000000-0000-7000-8000-000000000004", "carol", "different")]);

      return repo;
    }

    test("no page asks the port for every Page", async () => {
      expect(await listConversations(seeded(), {})).toHaveLength(3);
    });

    test("unresolved drops the settled ones", async () => {
      const listed = await listConversations(seeded(), { pagePath: "guide.md", unresolved: true });
      expect(listed.map((c) => c.comments[0]!.body)).toEqual(["still open"]);
    });

    test("since is measured on the Comments, not the header", async () => {
      const listed = await listConversations(seeded(), { since: "2025-01-20T00:00:00.000Z" });
      expect(listed.map((c) => c.comments[0]!.body)).toEqual(["still open"]);
    });

    test("an edit counts as activity, so a correction resurfaces", async () => {
      const repo = stubRepo();
      const header = makeHeader({ page: "guide.md" });
      repo.seed(header, [
        comment("00000000-0000-7000-8000-000000000001", "alice", "frist"),
        {
          id: "00000000-0000-7000-8000-000000000002",
          type: "edited",
          timestamp: "2025-02-01T09:00:00.000Z",
          author: "alice",
          target: "00000000-0000-7000-8000-000000000001",
          body: "first",
        },
      ]);

      expect(await listConversations(repo, { since: "2025-01-20T00:00:00.000Z" })).toHaveLength(1);
    });

    test("mentions matches the identity, slug-tolerantly", async () => {
      const listed = await listConversations(seeded(), { mentions: "Claude Code" });
      expect(listed).toHaveLength(1);
      expect(listed[0]!.comments[0]!.body).toContain("@claude-code");
    });

    test("a mention inside a tombstoned Comment does not count", async () => {
      const repo = stubRepo();
      const header = makeHeader({ page: "guide.md" });
      repo.seed(header, [
        comment("00000000-0000-7000-8000-000000000001", "alice", "@claude-code ignore that"),
        {
          id: "00000000-0000-7000-8000-000000000002",
          type: "deleted",
          timestamp: "2025-01-15T13:00:00.000Z",
          author: "alice",
          target: "00000000-0000-7000-8000-000000000001",
        },
      ]);

      expect(await listConversations(repo, { mentions: "claude-code" })).toEqual([]);
    });

    test("visibility narrows to Chats — what list_chats asks for", async () => {
      const repo = stubRepo();
      repo.seed(
        makeHeader({ id: "00000000-0000-7000-8000-00000000c0a1", page: "guide.md" }),
        [comment("00000000-0000-7000-8000-000000000001", "alice", "public")],
        "public",
      );
      repo.seed(
        makeHeader({ id: "00000000-0000-7000-8000-00000000c0b1", page: "guide.md" }),
        [comment("00000000-0000-7000-8000-000000000002", "alice", "private")],
        "private",
      );

      const chats = await listConversations(repo, { visibility: "private" });
      expect(chats.map((c) => c.comments[0]!.body)).toEqual(["private"]);
    });

    test("the filters compose", async () => {
      const listed = await listConversations(seeded(), {
        pagePath: "guide.md",
        unresolved: true,
        since: "2025-01-20T00:00:00.000Z",
      });
      expect(listed).toHaveLength(1);
      expect(listed[0]!.comments[0]!.body).toBe("still open");
    });
  });
});

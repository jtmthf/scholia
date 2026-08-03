// Promotion writes a new public Thread from a Chat and leaves the Chat alone
// (CONTEXT "Promotion", ADR-0019).
//
// The property under test throughout is that the Chat is *untouched*: not moved,
// not marked, not appended to. That is what makes Promotion safe to offer — the
// private original stays private whatever happens to the copy.

import { describe, test, expect } from "vitest";
import { ConversationError, promoteConversation } from "@scholia/core";
import { comment, makeHeader, stubRepo } from "./stub-repo.js";

const CHAT_ID = "00000000-0000-7000-8000-00000000ca01";

/** A Chat with three Comments, one of them an agent's. */
function chatWithThree() {
  const repo = stubRepo();
  const header = makeHeader({
    id: CHAT_ID,
    author: "alice",
    anchor: { textQuote: { exact: "unbounded retry", prefix: "the ", suffix: " loop" } },
    contentHash: "a".repeat(64),
  });
  repo.seed(
    header,
    [
      comment("00000000-0000-7000-8000-000000000001", "alice", "why is this retrying forever?"),
      {
        id: "00000000-0000-7000-8000-000000000002",
        type: "comment",
        timestamp: "2025-01-15T12:01:00.000Z",
        author: "Claude Code",
        authorKind: "agent",
        body: "There is no ceiling on the backoff.",
      },
      comment(
        "00000000-0000-7000-8000-000000000003",
        "alice",
        "ok, that's worth raising",
        "2025-01-15T12:02:00.000Z",
      ),
    ],
    "private",
  );
  return { repo, header };
}

describe("promoteConversation", () => {
  test("writes a new public Thread and leaves the Chat exactly as it was", async () => {
    const { repo } = chatWithThree();
    const before = await repo.getConversation(CHAT_ID);

    const thread = await promoteConversation(repo, {
      conversationId: CHAT_ID,
      commentIds: ["00000000-0000-7000-8000-000000000001"],
      author: "alice",
    });

    expect(thread.visibility).toBe("public");
    expect(thread.header.id).not.toBe(CHAT_ID);

    // Not a move: the Chat is still there, still private, still the same.
    const after = await repo.getConversation(CHAT_ID);
    expect(after).toEqual(before);
    expect(after!.visibility).toBe("private");
    // Nothing was appended to it either — "untouched" is literal.
    expect(repo.appended).toHaveLength(0);
  });

  test("carries only the chosen messages, in the order the Chat read", async () => {
    const { repo } = chatWithThree();

    const thread = await promoteConversation(repo, {
      conversationId: CHAT_ID,
      // Named out of order on purpose: the Thread should read as the
      // conversation happened, not as the caller happened to list it.
      commentIds: ["00000000-0000-7000-8000-000000000003", "00000000-0000-7000-8000-000000000001"],
      author: "alice",
    });

    expect(thread.comments.map((c) => c.body)).toEqual([
      "why is this retrying forever?",
      "ok, that's worth raising",
    ]);
  });

  test("keeps each message's author, kind and timestamp, but gives it a new id", async () => {
    const { repo } = chatWithThree();

    const thread = await promoteConversation(repo, {
      conversationId: CHAT_ID,
      commentIds: ["00000000-0000-7000-8000-000000000002"],
      author: "alice",
    });

    const promoted = thread.comments[0]!;
    // The agent badge survives Promotion: it is about who wrote the words, not
    // who published them.
    expect(promoted.author).toBe("Claude Code");
    expect(promoted.authorKind).toBe("agent");
    expect(promoted.timestamp).toBe("2025-01-15T12:01:00.000Z");
    // A new aggregate needs ids of its own — one id, one document, Sidecar-wide.
    expect(promoted.id).not.toBe("00000000-0000-7000-8000-000000000002");
    expect(promoted.conversationId).toBe(thread.header.id);
  });

  test("the Thread is about the same passage and the same bytes as the Chat", async () => {
    const { repo, header } = chatWithThree();

    const thread = await promoteConversation(repo, {
      conversationId: CHAT_ID,
      commentIds: ["00000000-0000-7000-8000-000000000001"],
      author: "bob",
    });

    expect(thread.header.page).toBe(header.page);
    expect(thread.header.anchor).toEqual(header.anchor);
    expect(thread.header.contentHash).toBe(header.contentHash);
    // Who made it public, not who started the Chat.
    expect(thread.header.author).toBe("bob");
  });

  test("a summary becomes a closing Comment from the promoting human", async () => {
    const { repo } = chatWithThree();

    const thread = await promoteConversation(repo, {
      conversationId: CHAT_ID,
      commentIds: ["00000000-0000-7000-8000-000000000001"],
      summary: "  Raising this: the backoff has no ceiling.  ",
      author: "alice",
    });

    expect(thread.comments).toHaveLength(2);
    const last = thread.comments[1]!;
    expect(last.body).toBe("Raising this: the backoff has no ceiling.");
    expect(last.author).toBe("alice");
    // Written now, so the fold — which orders by timestamp — puts it after the
    // messages it summarises.
    expect(last.timestamp > thread.comments[0]!.timestamp).toBe(true);
  });

  test("a summary alone is enough to promote", async () => {
    const { repo } = chatWithThree();

    const thread = await promoteConversation(repo, {
      conversationId: CHAT_ID,
      commentIds: [],
      summary: "We agreed to cap the backoff.",
      author: "alice",
    });

    expect(thread.comments.map((c) => c.body)).toEqual(["We agreed to cap the backoff."]);
  });

  test("the whole Thread lands in one write, not a create then a series of appends", async () => {
    const { repo } = chatWithThree();

    await promoteConversation(repo, {
      conversationId: CHAT_ID,
      commentIds: [
        "00000000-0000-7000-8000-000000000001",
        "00000000-0000-7000-8000-000000000002",
        "00000000-0000-7000-8000-000000000003",
      ],
      summary: "Summarised.",
      author: "alice",
    });

    // A Thread that landed with only some of the chosen messages would be a
    // Promotion that published less than it was told to.
    expect(repo.created).toHaveLength(1);
    expect(repo.appended).toHaveLength(0);
    // One first Comment plus the remaining two plus the summary, all in the
    // initial write.
    expect(repo.created[0]!.events).toHaveLength(3);
  });

  test("refuses to promote something that is already a Thread", async () => {
    const repo = stubRepo();
    const header = makeHeader({ id: CHAT_ID });
    repo.seed(header, [comment("00000000-0000-7000-8000-000000000001", "alice", "public")]);

    await expect(
      promoteConversation(repo, {
        conversationId: CHAT_ID,
        commentIds: ["00000000-0000-7000-8000-000000000001"],
        author: "alice",
      }),
    ).rejects.toThrow(/already a public Thread/);
  });

  test("refuses a Comment that is not in the Chat rather than quietly skipping it", async () => {
    const { repo } = chatWithThree();

    // Publishing something other than what the human picked is unrecoverable
    // once it is public, so an unknown id has to be loud.
    await expect(
      promoteConversation(repo, {
        conversationId: CHAT_ID,
        commentIds: ["00000000-0000-7000-8000-0000000000ff"],
        author: "alice",
      }),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  test("refuses a deleted Comment", async () => {
    const { repo } = chatWithThree();
    repo.seed(
      makeHeader({ id: CHAT_ID }),
      [
        comment("00000000-0000-7000-8000-000000000001", "alice", "retracted"),
        {
          id: "00000000-0000-7000-8000-0000000000de",
          type: "deleted",
          timestamp: "2025-01-15T12:03:00.000Z",
          author: "alice",
          target: "00000000-0000-7000-8000-000000000001",
        },
      ],
      "private",
    );

    await expect(
      promoteConversation(repo, {
        conversationId: CHAT_ID,
        commentIds: ["00000000-0000-7000-8000-000000000001"],
        author: "alice",
      }),
    ).rejects.toThrow(/deleted Comment cannot be promoted/);
  });

  test("refuses to promote nothing at all", async () => {
    const { repo } = chatWithThree();

    await expect(
      promoteConversation(repo, { conversationId: CHAT_ID, commentIds: [], author: "alice" }),
    ).rejects.toThrow(ConversationError);
  });

  test("refuses a Chat that does not exist", async () => {
    const repo = stubRepo();

    await expect(
      promoteConversation(repo, {
        conversationId: "00000000-0000-7000-8000-00000000dead",
        commentIds: [],
        author: "alice",
      }),
    ).rejects.toMatchObject({ code: "not-found" });
  });
});

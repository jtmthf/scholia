import { describe, test, expect, vi } from "vitest";
import { listConversations, type ConversationRepository, type Conversation } from "@scholia/core";

describe("listConversations", () => {
  test("delegates to listConversations on the port with the page path", async () => {
    const canned: Conversation[] = [
      {
        header: {
          id: "conv-1",
          page: "readme.md",
          anchor: null,
          author: "alice",
          timestamp: "2025-01-01T00:00:00.000Z",
        },
        comments: [
          {
            id: "cmt-1",
            conversationId: "conv-1",
            author: "alice",
            body: "hello",
            timestamp: "2025-01-01T00:00:00.000Z",
          },
        ],
      },
    ];

    const listSpy = vi.fn().mockResolvedValue(canned);
    const repo: ConversationRepository = {
      createConversation: vi.fn(),
      listConversations: listSpy,
    };

    const result = await listConversations(repo, "readme.md");
    expect(listSpy).toHaveBeenCalledWith("readme.md");
    expect(result).toEqual(canned);
  });

  test("returns empty array when no Conversations exist for the page", async () => {
    const repo: ConversationRepository = {
      createConversation: vi.fn(),
      listConversations: vi.fn().mockResolvedValue([]),
    };

    const result = await listConversations(repo, "nonexistent.md");
    expect(result).toEqual([]);
  });

  test("passes through multiple Conversations", async () => {
    const canned: Conversation[] = [
      {
        header: { id: "a", page: "guide.md", anchor: null, author: "x", timestamp: "t1" },
        comments: [],
      },
      {
        header: { id: "b", page: "guide.md", anchor: null, author: "y", timestamp: "t2" },
        comments: [],
      },
    ];
    const repo: ConversationRepository = {
      createConversation: vi.fn(),
      listConversations: vi.fn().mockResolvedValue(canned),
    };

    const result = await listConversations(repo, "guide.md");
    expect(result).toHaveLength(2);
  });
});

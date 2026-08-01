import { describe, test, expect, vi } from "vitest";
import {
  appendComment,
  createConversation,
  type ConversationRepository,
  type CreateConversationInput,
  type Conversation,
} from "@scholia/core";

// A stub repository that records calls and returns canned responses.
function stubRepo(impl?: Partial<ConversationRepository>): ConversationRepository {
  return {
    createConversation: vi.fn().mockImplementation(
      (input: CreateConversationInput): Promise<Conversation> =>
        Promise.resolve({
          header: input.header,
          comments: [
            {
              id: input.firstComment.id,
              conversationId: input.header.id,
              author: input.firstComment.author,
              body: input.firstComment.body,
              timestamp: input.firstComment.timestamp,
            },
          ],
        }),
    ),
    appendComment: vi.fn().mockResolvedValue(undefined),
    listConversations: vi.fn().mockResolvedValue([]),
    ...impl,
  };
}

describe("createConversation", () => {
  test("generates distinct UUIDv7 ids for Conversation and Comment", async () => {
    const repo = stubRepo();
    const result = await createConversation(repo, {
      pagePath: "docs/guide.md",
      body: "hello",
      anchor: null,
      author: "alice",
    });

    // UUIDv7 is 36 chars (8-4-4-4-12).
    expect(result.header.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(result.comments[0]!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    // They must be different.
    expect(result.header.id).not.toBe(result.comments[0]!.id);
  });

  test("sets ISO 8601 timestamps on header and first comment", async () => {
    const repo = stubRepo();
    const result = await createConversation(repo, {
      pagePath: "readme.md",
      body: "test",
      anchor: null,
      author: "bob",
    });

    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    expect(result.header.timestamp).toMatch(isoRegex);
    expect(result.comments[0]!.timestamp).toMatch(isoRegex);
    // Same timestamp for header and first comment (created together).
    expect(result.header.timestamp).toBe(result.comments[0]!.timestamp);
  });

  test("passes header and firstComment to createConversation on the port", async () => {
    const createSpy = vi.fn().mockImplementation(
      (input: CreateConversationInput): Promise<Conversation> =>
        Promise.resolve({
          header: input.header,
          comments: [
            {
              id: input.firstComment.id,
              conversationId: input.header.id,
              author: input.firstComment.author,
              body: input.firstComment.body,
              timestamp: input.firstComment.timestamp,
            },
          ],
        }),
    );
    const repo = stubRepo({ createConversation: createSpy });

    await createConversation(repo, {
      pagePath: "api/ref.md",
      body: "Needs review",
      anchor: {
        textQuote: { exact: "important section", prefix: "see the", suffix: "below" },
      },
      author: "carol",
    });

    expect(createSpy).toHaveBeenCalledTimes(1);
    const input = createSpy.mock.calls[0]![0]!;
    expect(input.header.page).toBe("api/ref.md");
    expect(input.header.author).toBe("carol");
    expect(input.header.anchor).toEqual({
      textQuote: { exact: "important section", prefix: "see the", suffix: "below" },
    });
    expect(input.firstComment.type).toBe("comment");
    expect(input.firstComment.body).toBe("Needs review");
    expect(input.firstComment.author).toBe("carol");
  });

  test("accepts null anchor for page-level Conversations", async () => {
    const repo = stubRepo();
    const result = await createConversation(repo, {
      pagePath: "index.md",
      body: "general comment",
      anchor: null,
      author: "dave",
    });

    expect(result.header.anchor).toBeNull();
  });

  // CONTEXT "Comment": the binding is the Page's content hash; Provenance rides
  // alongside as context. Both are optional, and an absent one must not surface
  // as a header field set to undefined.
  test("records the content hash and Provenance on the header", async () => {
    const repo = stubRepo();
    const result = await createConversation(repo, {
      pagePath: "index.md",
      body: "bound to what I read",
      anchor: null,
      author: "erin",
      contentHash: "b".repeat(64),
      provenance: { sha: "abc1234", branch: "main", dirty: false },
    });

    expect(result.header.contentHash).toBe("b".repeat(64));
    expect(result.header.provenance).toEqual({ sha: "abc1234", branch: "main", dirty: false });
  });

  test("omits the binding fields when the caller has neither", async () => {
    const repo = stubRepo();
    const result = await createConversation(repo, {
      pagePath: "index.md",
      body: "no repo, no file",
      anchor: null,
      author: "frank",
    });

    expect("contentHash" in result.header).toBe(false);
    expect("provenance" in result.header).toBe(false);
  });
});

describe("appendComment", () => {
  test("appends a `comment` event with its own UUIDv7 id", async () => {
    const appendSpy = vi.fn().mockResolvedValue(undefined);
    const repo = stubRepo({ appendComment: appendSpy });

    const comment = await appendComment(repo, {
      conversationId: "00000000-0000-7000-8000-000000000001",
      body: "Agreed.",
      author: "grace",
    });

    expect(appendSpy).toHaveBeenCalledTimes(1);
    const [conversationId, event] = appendSpy.mock.calls[0]!;
    expect(conversationId).toBe("00000000-0000-7000-8000-000000000001");
    expect(event.type).toBe("comment");
    expect(event.body).toBe("Agreed.");
    expect(event.author).toBe("grace");
    expect(event.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    // The Comment handed back describes the event that was appended.
    expect(comment.id).toBe(event.id);
    expect(comment.conversationId).toBe("00000000-0000-7000-8000-000000000001");
    expect(comment.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test("surfaces the repository's rejection rather than swallowing it", async () => {
    const repo = stubRepo({
      appendComment: vi.fn().mockRejectedValue(new Error("no Conversation abc in the Sidecar")),
    });

    await expect(
      appendComment(repo, { conversationId: "abc", body: "hi", author: "heidi" }),
    ).rejects.toThrow(/no Conversation/);
  });
});

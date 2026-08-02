// The rest of the Conversation verb set: resolve, reopen, react, edit, delete.
//
// Two claims run through all of them. Every one appends an event and rewrites
// nothing — asserted by reading the appended stream, not the folded result. And
// every one authorizes before it appends, because the stream itself cannot say
// no: an `edited` event naming someone else's Comment is a well-formed document
// the fold would honour.

import { describe, test, expect } from "vitest";
import {
  ConversationError,
  deleteComment,
  deleteConversation,
  editComment,
  setReaction,
  setResolved,
} from "@scholia/core";
import { comment, makeHeader, stubRepo, type StubRepo } from "./stub-repo.js";

const CONVERSATION = "00000000-0000-7000-8000-00000000c001";
const ALICE_COMMENT = "00000000-0000-7000-8000-000000000001";
const BOB_COMMENT = "00000000-0000-7000-8000-000000000002";

/** A Conversation Alice started and Bob replied to. */
function seeded(): StubRepo {
  const repo = stubRepo();
  repo.seed(makeHeader({ id: CONVERSATION }), [
    comment(ALICE_COMMENT, "alice", "This is wrong.", "2025-01-15T12:00:00.000Z"),
    comment(BOB_COMMENT, "bob", "Is it?", "2025-01-15T12:05:00.000Z"),
  ]);
  return repo;
}

async function reload(repo: StubRepo) {
  return (await repo.getConversation(CONVERSATION))!;
}

describe("setResolved", () => {
  test("resolving appends a `resolved` event carrying its author", async () => {
    const repo = seeded();
    await setResolved(repo, { conversationId: CONVERSATION, resolved: true, author: "bob" });

    expect(repo.appended).toHaveLength(1);
    expect(repo.appended[0]).toMatchObject({ type: "resolved", author: "bob" });

    const conversation = await reload(repo);
    expect(conversation.resolved).toBe(true);
    expect(conversation.resolvedBy).toBe("bob");
  });

  test("reopening appends a `reopened` event rather than retracting the first", async () => {
    const repo = seeded();
    await setResolved(repo, { conversationId: CONVERSATION, resolved: true, author: "bob" });
    await setResolved(repo, { conversationId: CONVERSATION, resolved: false, author: "alice" });

    // Both events are in the stream: nothing was rewritten or removed.
    expect(repo.appended.map((e) => e.type)).toEqual(["resolved", "reopened"]);

    const conversation = await reload(repo);
    expect(conversation.resolved).toBe(false);
    expect(conversation.resolvedBy).toBeNull();
  });

  // Reassigning `resolvedBy` to whoever clicked last would be a quiet lie about
  // who settled it.
  test("resolving an already-resolved Conversation writes nothing", async () => {
    const repo = seeded();
    await setResolved(repo, { conversationId: CONVERSATION, resolved: true, author: "bob" });
    await setResolved(repo, { conversationId: CONVERSATION, resolved: true, author: "carol" });

    expect(repo.appended).toHaveLength(1);
    expect((await reload(repo)).resolvedBy).toBe("bob");
  });

  // Resolving is not moderation — anyone reading the thread can see it is settled.
  test("anyone may resolve, not only the Conversation's author", async () => {
    const repo = seeded();
    await setResolved(repo, { conversationId: CONVERSATION, resolved: true, author: "carol" });
    expect((await reload(repo)).resolvedBy).toBe("carol");
  });

  test("a Conversation that does not exist is not found", async () => {
    const repo = seeded();
    await expect(
      setResolved(repo, { conversationId: "nope", resolved: true, author: "bob" }),
    ).rejects.toThrow(ConversationError);
  });
});

describe("editComment", () => {
  test("an edit appends an `edited` event and leaves the original in the stream", async () => {
    const repo = seeded();
    const edited = await editComment(repo, {
      conversationId: CONVERSATION,
      commentId: ALICE_COMMENT,
      body: "This is out of date.",
      author: "alice",
    });

    expect(repo.appended).toHaveLength(1);
    expect(repo.appended[0]).toMatchObject({
      type: "edited",
      target: ALICE_COMMENT,
      body: "This is out of date.",
    });
    expect(edited.editedAt).not.toBeNull();

    const conversation = await reload(repo);
    expect(conversation.comments[0]!.body).toBe("This is out of date.");
    expect(conversation.comments[0]!.editedAt).not.toBeNull();
  });

  // The Owner may delete anyone's Comment; nobody may put words in their mouth.
  test("only the author may edit — there is no moderator override", async () => {
    const repo = seeded();
    await expect(
      editComment(repo, {
        conversationId: CONVERSATION,
        commentId: ALICE_COMMENT,
        body: "not mine to change",
        author: "bob",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });

    expect(repo.appended).toHaveLength(0);
  });

  test("an empty body is refused rather than stored", async () => {
    const repo = seeded();
    await expect(
      editComment(repo, {
        conversationId: CONVERSATION,
        commentId: ALICE_COMMENT,
        body: "   ",
        author: "alice",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  test("a deleted Comment cannot be edited back into existence", async () => {
    const repo = seeded();
    await deleteComment(repo, {
      conversationId: CONVERSATION,
      commentId: ALICE_COMMENT,
      author: "alice",
    });

    await expect(
      editComment(repo, {
        conversationId: CONVERSATION,
        commentId: ALICE_COMMENT,
        body: "back",
        author: "alice",
      }),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  test("a Comment that is not in this Conversation is not found", async () => {
    const repo = seeded();
    await expect(
      editComment(repo, {
        conversationId: CONVERSATION,
        commentId: "00000000-0000-7000-8000-0000000000ff",
        body: "hi",
        author: "alice",
      }),
    ).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("deleteComment", () => {
  test("a delete leaves a tombstone, not a hole", async () => {
    const repo = seeded();
    await deleteComment(repo, {
      conversationId: CONVERSATION,
      commentId: ALICE_COMMENT,
      author: "alice",
    });

    expect(repo.appended[0]).toMatchObject({ type: "deleted", target: ALICE_COMMENT });

    const conversation = await reload(repo);
    // Still two Comments — the deleted one is a tombstone, so the reply below it
    // still reads as a reply to something.
    expect(conversation.comments).toHaveLength(2);
    expect(conversation.comments[0]!.deleted).toBe(true);
    expect(conversation.comments[0]!.body).toBe("");
  });

  test("someone else's Comment is refused", async () => {
    const repo = seeded();
    await expect(
      deleteComment(repo, {
        conversationId: CONVERSATION,
        commentId: ALICE_COMMENT,
        author: "bob",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(repo.appended).toHaveLength(0);
  });

  test("the Owner may delete anyone's Comment", async () => {
    const repo = seeded();
    await deleteComment(repo, {
      conversationId: CONVERSATION,
      commentId: ALICE_COMMENT,
      author: "bob",
      isOwner: true,
    });

    expect((await reload(repo)).comments[0]!.deleted).toBe(true);
  });

  test("deleting an already-deleted Comment writes nothing", async () => {
    const repo = seeded();
    const params = {
      conversationId: CONVERSATION,
      commentId: ALICE_COMMENT,
      author: "alice",
    };
    await deleteComment(repo, params);
    await deleteComment(repo, params);

    expect(repo.appended).toHaveLength(1);
  });
});

describe("deleteConversation", () => {
  test("the Owner deletes the whole aggregate with a tombstone on its own id", async () => {
    const repo = seeded();
    await deleteConversation(repo, {
      conversationId: CONVERSATION,
      author: "owner",
      isOwner: true,
    });

    expect(repo.appended[0]).toMatchObject({ type: "deleted", target: CONVERSATION });

    const conversation = await reload(repo);
    expect(conversation.deleted).toBe(true);
    // Every Comment is still in the stream — the file was not touched.
    expect(conversation.comments).toHaveLength(2);
  });

  // A Conversation holds other people's words, so it is the Owner's alone.
  test("a non-Owner is refused", async () => {
    const repo = seeded();
    await expect(
      deleteConversation(repo, { conversationId: CONVERSATION, author: "alice" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(repo.appended).toHaveLength(0);
  });

  test("a deleted Conversation cannot be commented on again", async () => {
    const repo = seeded();
    await deleteConversation(repo, {
      conversationId: CONVERSATION,
      author: "owner",
      isOwner: true,
    });

    await expect(
      setResolved(repo, { conversationId: CONVERSATION, resolved: true, author: "alice" }),
    ).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("setReaction", () => {
  test("reacting appends a `reacted` event and tallies the author", async () => {
    const repo = seeded();
    const on = await setReaction(repo, {
      conversationId: CONVERSATION,
      commentId: ALICE_COMMENT,
      emoji: "👍",
      author: "bob",
    });

    expect(on).toBe(true);
    expect(repo.appended[0]).toMatchObject({
      type: "reacted",
      target: ALICE_COMMENT,
      emoji: "👍",
      author: "bob",
    });
    expect((await reload(repo)).comments[0]!.reactions).toEqual([
      { emoji: "👍", authors: ["bob"] },
    ]);
  });

  test("reacting again toggles it off with an `unreacted` event", async () => {
    const repo = seeded();
    const params = {
      conversationId: CONVERSATION,
      commentId: ALICE_COMMENT,
      emoji: "👍",
      author: "bob",
    };
    await setReaction(repo, params);
    const on = await setReaction(repo, params);

    expect(on).toBe(false);
    expect(repo.appended.map((e) => e.type)).toEqual(["reacted", "unreacted"]);
    expect((await reload(repo)).comments[0]!.reactions).toEqual([]);
  });

  // An agent that means "make sure this is reacted" should not un-react by
  // calling twice, so the state can be asked for outright.
  test("an explicit `on` sets the state instead of toggling", async () => {
    const repo = seeded();
    const params = {
      conversationId: CONVERSATION,
      commentId: ALICE_COMMENT,
      emoji: "✅",
      author: "agent",
    };
    await setReaction(repo, { ...params, on: true });
    await setReaction(repo, { ...params, on: true });

    expect(repo.appended).toHaveLength(1);
    expect((await reload(repo)).comments[0]!.reactions).toEqual([
      { emoji: "✅", authors: ["agent"] },
    ]);
  });

  test("an agent reacts exactly as a human does", async () => {
    const repo = seeded();
    await setReaction(repo, {
      conversationId: CONVERSATION,
      commentId: BOB_COMMENT,
      emoji: "👀",
      author: "claude",
    });
    await setReaction(repo, {
      conversationId: CONVERSATION,
      commentId: BOB_COMMENT,
      emoji: "👀",
      author: "alice",
    });

    expect((await reload(repo)).comments[1]!.reactions).toEqual([
      { emoji: "👀", authors: ["alice", "claude"] },
    ]);
  });

  test("an emoji outside the palette is refused rather than stored", async () => {
    const repo = seeded();
    await expect(
      setReaction(repo, {
        conversationId: CONVERSATION,
        commentId: ALICE_COMMENT,
        emoji: "🦖",
        author: "bob",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(repo.appended).toHaveLength(0);
  });

  test("a deleted Comment takes no reactions", async () => {
    const repo = seeded();
    await deleteComment(repo, {
      conversationId: CONVERSATION,
      commentId: ALICE_COMMENT,
      author: "alice",
    });

    await expect(
      setReaction(repo, {
        conversationId: CONVERSATION,
        commentId: ALICE_COMMENT,
        emoji: "👍",
        author: "bob",
      }),
    ).rejects.toMatchObject({ code: "not-found" });
  });
});

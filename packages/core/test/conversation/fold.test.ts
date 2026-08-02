// The fold is where "every change is an event" becomes a Conversation someone
// can read (ADR-0019, ADR-0032). Its whole job is to be deterministic: the same
// events in any order, with any duplicates, must produce the same Conversation,
// because git's union merge controls neither order nor multiplicity.

import { describe, test, expect } from "vitest";
import { foldConversation, type ConversationEvent, type ConversationHeader } from "@scholia/core";

const header: ConversationHeader = {
  id: "00000000-0000-7000-8000-00000000c001",
  page: "docs/guide.md",
  anchor: null,
  author: "alice",
  timestamp: "2025-01-15T12:00:00.000Z",
};

const first: ConversationEvent = {
  id: "00000000-0000-7000-8000-000000000001",
  type: "comment",
  timestamp: "2025-01-15T12:00:00.000Z",
  author: "alice",
  body: "This paragraph is wrong.",
};

const reply: ConversationEvent = {
  id: "00000000-0000-7000-8000-000000000002",
  type: "comment",
  timestamp: "2025-01-15T12:05:00.000Z",
  author: "bob",
  body: "Agreed — fixing.",
};

/** Every permutation of `events`, so a claim about order covers all of them. */
function permutations<T>(events: T[]): T[][] {
  if (events.length <= 1) return [events];
  return events.flatMap((event, i) =>
    permutations([...events.slice(0, i), ...events.slice(i + 1)]).map((rest) => [event, ...rest]),
  );
}

/** Assert the fold is the same whichever order the events arrive in. */
function foldsIdentically(events: ConversationEvent[]) {
  const [expected, ...others] = permutations(events).map((p) => foldConversation(header, p));
  for (const actual of others) expect(actual).toEqual(expected);
  return expected!;
}

describe("foldConversation", () => {
  test("folds `comment` events into Comments in timestamp order", () => {
    const conversation = foldConversation(header, [reply, first]);

    expect(conversation.comments.map((c) => c.body)).toEqual([
      "This paragraph is wrong.",
      "Agreed — fixing.",
    ]);
    expect(conversation.comments[0]!.conversationId).toBe(header.id);
    expect(conversation.resolved).toBe(false);
    expect(conversation.deleted).toBe(false);
  });

  test("dedupes by event id, so a cherry-picked event is a no-op", () => {
    const conversation = foldConversation(header, [first, reply, { ...reply }]);
    expect(conversation.comments).toHaveLength(2);
  });

  // ---- edited ----

  test("an `edited` event replaces the body and marks the Comment edited", () => {
    const conversation = foldsIdentically([
      first,
      {
        id: "00000000-0000-7000-8000-000000000003",
        type: "edited",
        timestamp: "2025-01-15T12:10:00.000Z",
        author: "alice",
        target: first.id,
        body: "This paragraph is out of date.",
      },
    ]);

    expect(conversation.comments[0]!.body).toBe("This paragraph is out of date.");
    expect(conversation.comments[0]!.editedAt).toBe("2025-01-15T12:10:00.000Z");
    // The Comment keeps the time it was written, not the time it was edited.
    expect(conversation.comments[0]!.timestamp).toBe("2025-01-15T12:00:00.000Z");
  });

  test("the latest `edited` event wins, whichever order they arrive in", () => {
    const conversation = foldsIdentically([
      first,
      {
        id: "00000000-0000-7000-8000-000000000003",
        type: "edited",
        timestamp: "2025-01-15T12:10:00.000Z",
        author: "alice",
        target: first.id,
        body: "first edit",
      },
      {
        id: "00000000-0000-7000-8000-000000000004",
        type: "edited",
        timestamp: "2025-01-15T12:20:00.000Z",
        author: "alice",
        target: first.id,
        body: "second edit",
      },
    ]);

    expect(conversation.comments[0]!.body).toBe("second edit");
    expect(conversation.comments[0]!.editedAt).toBe("2025-01-15T12:20:00.000Z");
  });

  test("two edits in the same millisecond are broken by event id, not by arrival", () => {
    const conversation = foldsIdentically([
      first,
      {
        id: "00000000-0000-7000-8000-0000000000aa",
        type: "edited",
        timestamp: "2025-01-15T12:10:00.000Z",
        author: "alice",
        target: first.id,
        body: "aa",
      },
      {
        id: "00000000-0000-7000-8000-0000000000bb",
        type: "edited",
        timestamp: "2025-01-15T12:10:00.000Z",
        author: "alice",
        target: first.id,
        body: "bb",
      },
    ]);

    expect(conversation.comments[0]!.body).toBe("bb");
  });

  // ---- deleted ----

  test("a `deleted` event leaves a tombstone with no body", () => {
    const conversation = foldsIdentically([
      first,
      reply,
      {
        id: "00000000-0000-7000-8000-000000000005",
        type: "deleted",
        timestamp: "2025-01-15T12:30:00.000Z",
        author: "bob",
        target: reply.id,
      },
    ]);

    // The tombstone keeps its place in the thread — a reply below it still reads
    // as a reply to something.
    expect(conversation.comments).toHaveLength(2);
    expect(conversation.comments[1]!.deleted).toBe(true);
    expect(conversation.comments[1]!.body).toBe("");
  });

  // A delete that a later edit could undo would mean a body someone removed can
  // come back on merge — so the tombstone absorbs everything (ADR-0032).
  test("a tombstone is absorbing: a later edit cannot resurrect the body", () => {
    const conversation = foldsIdentically([
      first,
      {
        id: "00000000-0000-7000-8000-000000000005",
        type: "deleted",
        timestamp: "2025-01-15T12:30:00.000Z",
        author: "alice",
        target: first.id,
      },
      {
        id: "00000000-0000-7000-8000-000000000006",
        type: "edited",
        timestamp: "2025-01-15T12:40:00.000Z",
        author: "alice",
        target: first.id,
        body: "back from the dead",
      },
    ]);

    expect(conversation.comments[0]!.deleted).toBe(true);
    expect(conversation.comments[0]!.body).toBe("");
  });

  test("a tombstone drops the Comment's reactions with its body", () => {
    const conversation = foldsIdentically([
      first,
      {
        id: "00000000-0000-7000-8000-000000000007",
        type: "reacted",
        timestamp: "2025-01-15T12:20:00.000Z",
        author: "bob",
        target: first.id,
        emoji: "👍",
      },
      {
        id: "00000000-0000-7000-8000-000000000008",
        type: "deleted",
        timestamp: "2025-01-15T12:30:00.000Z",
        author: "alice",
        target: first.id,
      },
    ]);

    expect(conversation.comments[0]!.reactions).toEqual([]);
  });

  test("a `deleted` event targeting the Conversation itself deletes the whole aggregate", () => {
    const conversation = foldsIdentically([
      first,
      reply,
      {
        id: "00000000-0000-7000-8000-000000000009",
        type: "deleted",
        timestamp: "2025-01-15T13:00:00.000Z",
        author: "alice",
        target: header.id,
      },
    ]);

    expect(conversation.deleted).toBe(true);
    // The events are still there — nothing was removed from the stream.
    expect(conversation.comments).toHaveLength(2);
  });

  // ---- reactions ----

  test("reactions group by emoji with their authors sorted", () => {
    const conversation = foldsIdentically([
      first,
      {
        id: "00000000-0000-7000-8000-00000000000a",
        type: "reacted",
        timestamp: "2025-01-15T12:10:00.000Z",
        author: "carol",
        target: first.id,
        emoji: "👍",
      },
      {
        id: "00000000-0000-7000-8000-00000000000b",
        type: "reacted",
        timestamp: "2025-01-15T12:11:00.000Z",
        author: "bob",
        target: first.id,
        emoji: "👍",
      },
    ]);

    expect(conversation.comments[0]!.reactions).toEqual([
      { emoji: "👍", authors: ["bob", "carol"] },
    ]);
  });

  test("the same author reacting twice with the same emoji counts once", () => {
    const conversation = foldsIdentically([
      first,
      {
        id: "00000000-0000-7000-8000-00000000000a",
        type: "reacted",
        timestamp: "2025-01-15T12:10:00.000Z",
        author: "bob",
        target: first.id,
        emoji: "👍",
      },
      {
        id: "00000000-0000-7000-8000-00000000000b",
        type: "reacted",
        timestamp: "2025-01-15T12:11:00.000Z",
        author: "bob",
        target: first.id,
        emoji: "👍",
      },
    ]);

    expect(conversation.comments[0]!.reactions).toEqual([{ emoji: "👍", authors: ["bob"] }]);
  });

  test("`unreacted` takes a reaction back, and the emoji disappears when nobody is left", () => {
    const conversation = foldsIdentically([
      first,
      {
        id: "00000000-0000-7000-8000-00000000000a",
        type: "reacted",
        timestamp: "2025-01-15T12:10:00.000Z",
        author: "bob",
        target: first.id,
        emoji: "👍",
      },
      {
        id: "00000000-0000-7000-8000-00000000000b",
        type: "unreacted",
        timestamp: "2025-01-15T12:11:00.000Z",
        author: "bob",
        target: first.id,
        emoji: "👍",
      },
    ]);

    expect(conversation.comments[0]!.reactions).toEqual([]);
  });

  test("one author's `unreacted` does not remove another author's reaction", () => {
    const conversation = foldsIdentically([
      first,
      {
        id: "00000000-0000-7000-8000-00000000000a",
        type: "reacted",
        timestamp: "2025-01-15T12:10:00.000Z",
        author: "bob",
        target: first.id,
        emoji: "👍",
      },
      {
        id: "00000000-0000-7000-8000-00000000000b",
        type: "reacted",
        timestamp: "2025-01-15T12:11:00.000Z",
        author: "carol",
        target: first.id,
        emoji: "👍",
      },
      {
        id: "00000000-0000-7000-8000-00000000000c",
        type: "unreacted",
        timestamp: "2025-01-15T12:12:00.000Z",
        author: "bob",
        target: first.id,
        emoji: "👍",
      },
    ]);

    expect(conversation.comments[0]!.reactions).toEqual([{ emoji: "👍", authors: ["carol"] }]);
  });

  test("reactions come back in palette order, not the order they were added", () => {
    const conversation = foldsIdentically([
      first,
      {
        id: "00000000-0000-7000-8000-00000000000a",
        type: "reacted",
        timestamp: "2025-01-15T12:10:00.000Z",
        author: "bob",
        target: first.id,
        emoji: "🎉",
      },
      {
        id: "00000000-0000-7000-8000-00000000000b",
        type: "reacted",
        timestamp: "2025-01-15T12:11:00.000Z",
        author: "bob",
        target: first.id,
        emoji: "👍",
      },
    ]);

    expect(conversation.comments[0]!.reactions.map((r) => r.emoji)).toEqual(["👍", "🎉"]);
  });

  // ---- resolve / reopen ----

  test("a `resolved` event resolves the Conversation and records who did it", () => {
    const conversation = foldsIdentically([
      first,
      {
        id: "00000000-0000-7000-8000-00000000000d",
        type: "resolved",
        timestamp: "2025-01-15T12:30:00.000Z",
        author: "bob",
      },
    ]);

    expect(conversation.resolved).toBe(true);
    expect(conversation.resolvedBy).toBe("bob");
    expect(conversation.resolvedAt).toBe("2025-01-15T12:30:00.000Z");
  });

  test("a later `reopened` event wins, and clears who resolved it", () => {
    const conversation = foldsIdentically([
      first,
      {
        id: "00000000-0000-7000-8000-00000000000d",
        type: "resolved",
        timestamp: "2025-01-15T12:30:00.000Z",
        author: "bob",
      },
      {
        id: "00000000-0000-7000-8000-00000000000e",
        type: "reopened",
        timestamp: "2025-01-15T12:40:00.000Z",
        author: "alice",
      },
    ]);

    expect(conversation.resolved).toBe(false);
    expect(conversation.resolvedBy).toBeNull();
    expect(conversation.resolvedAt).toBeNull();
  });

  // The AC's conflict case: one side resolved, the other reopened, and union
  // merge hands both to every reader. Whoever acted last wins, and every reader
  // agrees on who that was because the tiebreak is the event id.
  test("a concurrent resolve and reopen in the same millisecond folds the same way for everyone", () => {
    const resolved: ConversationEvent = {
      id: "00000000-0000-7000-8000-0000000000aa",
      type: "resolved",
      timestamp: "2025-01-15T12:30:00.000Z",
      author: "bob",
    };
    const reopened: ConversationEvent = {
      id: "00000000-0000-7000-8000-0000000000bb",
      type: "reopened",
      timestamp: "2025-01-15T12:30:00.000Z",
      author: "carol",
    };

    const conversation = foldsIdentically([first, resolved, reopened]);
    // `bb` sorts after `aa`, so the reopen is the later event on every machine.
    expect(conversation.resolved).toBe(false);
  });

  // ---- robustness ----

  test("an event targeting a Comment that isn't there is ignored, not an error", () => {
    const conversation = foldConversation(header, [
      first,
      {
        id: "00000000-0000-7000-8000-00000000000f",
        type: "edited",
        timestamp: "2025-01-15T12:30:00.000Z",
        author: "alice",
        target: "00000000-0000-7000-8000-0000000000ff",
        body: "orphan",
      },
    ]);

    expect(conversation.comments).toHaveLength(1);
    expect(conversation.comments[0]!.body).toBe("This paragraph is wrong.");
  });

  test("a stream with no `comment` events folds to an empty Conversation", () => {
    const conversation = foldConversation(header, []);
    expect(conversation).toEqual({
      header,
      comments: [],
      resolved: false,
      resolvedBy: null,
      resolvedAt: null,
      deleted: false,
    });
  });
});

// Two writers on one Sidecar (ADR-0019, ADR-0020).
//
// Invoking the application in-process means an agent writes to the same files a
// preview server is serving from, at the same time, with no lock between them.
// That is a deliberate trade — the alternative was a daemon nobody would be
// running at 3am — and it rests on two properties of the store: every write is
// one atomic append of a whole document, and nothing is ever rewritten.
//
// So the guarantee is not "no interleaving". It is that interleaving is
// harmless: every event survives, the stream still parses, and the fold puts
// them in timestamp order regardless of what order they landed in.

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SidecarStore } from "../src/store.js";
import { createLocalApi } from "../src/local-api.js";

describe("concurrent writers", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "scholia-concurrent-test-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  const conversationId = "00000000-0000-7000-8000-0000000000a0";

  async function seed(store: SidecarStore): Promise<void> {
    await store.createConversation({
      header: {
        id: conversationId,
        page: "readme.md",
        anchor: null,
        author: "reader",
        timestamp: "2025-01-15T12:00:00.000Z",
      },
      firstComment: {
        id: "00000000-0000-7000-8000-0000000000a1",
        type: "comment",
        timestamp: "2025-01-15T12:00:00.000Z",
        author: "reader",
        body: "first",
      },
    });
  }

  test("appends from two stores interleave rather than corrupt", async () => {
    // Two processes' worth of state: the preview server holds one store, the
    // agent's in-process application holds another.
    const server = new SidecarStore(rootDir);
    const agent = new SidecarStore(rootDir);
    await seed(server);

    const writes = Array.from({ length: 40 }, (_, i) => {
      const store = i % 2 === 0 ? server : agent;
      return store.appendEvent(conversationId, {
        id: `00000000-0000-7000-8000-${String(i).padStart(12, "0")}`,
        type: "comment",
        timestamp: `2025-01-15T12:${String(i).padStart(2, "0")}:00.000Z`,
        author: i % 2 === 0 ? "reader" : "Claude Code",
        ...(i % 2 === 0 ? {} : { authorKind: "agent" as const }),
        body: `message ${i}`,
      });
    });

    await Promise.all(writes);

    const conversation = await server.getConversation(conversationId);
    // The seed plus every concurrent append, none lost and none duplicated.
    expect(conversation!.comments).toHaveLength(41);
    expect(new Set(conversation!.comments.map((c) => c.id)).size).toBe(41);

    // Order comes from the timestamps, not from where a race put the bytes.
    const timestamps = conversation!.comments.map((c) => c.timestamp);
    expect([...timestamps].sort()).toEqual(timestamps);

    // Every document is still whole: one opening and one closing marker each.
    const raw = await readFile(
      join(rootDir, ".scholia", "conversations", `${conversationId}.yaml`),
      "utf8",
    );
    const opens = raw.match(/^--- # /gm)!.length;
    const closes = raw.match(/^\.\.\. # /gm)!.length;
    expect(opens).toBe(42); // the header plus 41 events
    expect(closes).toBe(opens);
  });

  test("an agent replying and a reader resolving do not lose each other", async () => {
    const server = new SidecarStore(rootDir);
    await seed(server);
    const agent = createLocalApi({ rootDir });

    await Promise.all([
      agent.reply({ conversation: conversationId, body: "on it", agent: "Claude Code" }),
      agent.resolve({ conversation: conversationId }),
      agent.react({
        conversation: conversationId,
        comment: "00000000-0000-7000-8000-0000000000a1",
        emoji: "👀",
      }),
    ]);

    const conversation = await server.getConversation(conversationId);
    expect(conversation!.resolved).toBe(true);
    expect(conversation!.comments).toHaveLength(2);
    expect(conversation!.comments[0]!.reactions[0]!.emoji).toBe("👀");
  });

  test("two agents starting Conversations at once both land", async () => {
    const agents = [createLocalApi({ rootDir }), createLocalApi({ rootDir })];

    const created = await Promise.all(
      agents.map((api, i) => api.comment({ page: "readme.md", body: `from agent ${i}` })),
    );

    const listed = await new SidecarStore(rootDir).listConversations("readme.md");
    expect(listed).toHaveLength(2);
    expect(new Set(listed.map((c) => c.header.id))).toEqual(new Set(created.map((c) => c.id)));
  });
});

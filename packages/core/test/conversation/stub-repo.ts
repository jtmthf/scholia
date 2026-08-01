// A ConversationRepository that keeps its streams in memory and folds them with
// the real fold.
//
// The commands are worth testing against something that actually replays what
// they append — an authorization check reads the aggregate back before it
// decides, so a repo that returned canned data would test the check against a
// world its own writes never reach.

import { vi } from "vitest";
import {
  foldConversation,
  type Conversation,
  type ConversationEvent,
  type ConversationHeader,
  type ConversationRepository,
  type CreateConversationInput,
} from "@scholia/core";

export interface StubRepo extends ConversationRepository {
  /** Every event appended since construction, in call order. */
  readonly appended: ConversationEvent[];
  /** Seed a stream directly, bypassing the commands. */
  seed(header: ConversationHeader, events: ConversationEvent[]): void;
}

export function makeHeader(overrides: Partial<ConversationHeader> = {}): ConversationHeader {
  return {
    id: "00000000-0000-7000-8000-00000000c001",
    page: "docs/guide.md",
    anchor: null,
    author: "alice",
    timestamp: "2025-01-15T12:00:00.000Z",
    ...overrides,
  };
}

export function comment(
  id: string,
  author: string,
  body: string,
  timestamp = "2025-01-15T12:00:00.000Z",
): ConversationEvent {
  return { id, type: "comment", timestamp, author, body };
}

export function stubRepo(): StubRepo {
  const streams = new Map<string, { header: ConversationHeader; events: ConversationEvent[] }>();
  const appended: ConversationEvent[] = [];

  const repo: StubRepo = {
    appended,
    seed(header, events) {
      streams.set(header.id, { header, events: [...events] });
    },
    createConversation: vi.fn((input: CreateConversationInput): Promise<Conversation> => {
      streams.set(input.header.id, { header: input.header, events: [input.firstComment] });
      return Promise.resolve(foldConversation(input.header, [input.firstComment]));
    }),
    appendEvent: vi.fn((conversationId: string, event: ConversationEvent): Promise<void> => {
      const stream = streams.get(conversationId);
      if (!stream) return Promise.reject(new Error(`no Conversation ${conversationId}`));
      stream.events.push(event);
      appended.push(event);
      return Promise.resolve();
    }),
    getConversation: vi.fn((conversationId: string): Promise<Conversation | null> => {
      const stream = streams.get(conversationId);
      return Promise.resolve(stream ? foldConversation(stream.header, stream.events) : null);
    }),
    listConversations: vi.fn(
      (pagePath: string): Promise<Conversation[]> =>
        Promise.resolve(
          [...streams.values()]
            .filter((s) => s.header.page === pagePath)
            .map((s) => foldConversation(s.header, s.events)),
        ),
    ),
  };

  return repo;
}

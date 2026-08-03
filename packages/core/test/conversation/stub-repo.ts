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
  type Visibility,
} from "@scholia/core";

export interface StubRepo extends ConversationRepository {
  /** Every event appended since construction, in call order. */
  readonly appended: ConversationEvent[];
  /**
   * Every `createConversation` call, in order. Recorded alongside `appended` so
   * a test can say what landed in the *initial* write versus what was appended
   * afterwards — which is the difference Promotion's atomicity turns on.
   */
  readonly created: CreateConversationInput[];
  /**
   * Seed a stream directly, bypassing the commands. `visibility` stands in for
   * the directory the Sidecar would have found it in (ADR-0019).
   */
  seed(header: ConversationHeader, events: ConversationEvent[], visibility?: Visibility): void;
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

interface Stream {
  header: ConversationHeader;
  events: ConversationEvent[];
  visibility: Visibility;
}

export function stubRepo(): StubRepo {
  const streams = new Map<string, Stream>();
  const appended: ConversationEvent[] = [];
  const created: CreateConversationInput[] = [];

  const fold = (stream: Stream): Conversation =>
    foldConversation(stream.header, stream.events, stream.visibility);

  const repo: StubRepo = {
    appended,
    created,
    seed(header, events, visibility = "public") {
      streams.set(header.id, { header, events: [...events], visibility });
    },
    createConversation: vi.fn((input: CreateConversationInput): Promise<Conversation> => {
      created.push(input);
      const stream: Stream = {
        header: input.header,
        // The whole initial stream, not just the first Comment — Promotion
        // creates a Conversation that already has a history.
        events: [input.firstComment, ...(input.events ?? [])],
        visibility: input.visibility ?? "public",
      };
      streams.set(input.header.id, stream);
      return Promise.resolve(fold(stream));
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
      return Promise.resolve(stream ? fold(stream) : null);
    }),
    listConversations: vi.fn(
      (pagePath: string): Promise<Conversation[]> =>
        Promise.resolve([...streams.values()].filter((s) => s.header.page === pagePath).map(fold)),
    ),
  };

  return repo;
}

import type { ComponentChildren } from "preact";
import { renderToString } from "preact-render-to-string";
import {
  CommentsProvider,
  type CommentDTO,
  type CommentsPort,
  type ConversationDTO,
  type Identity,
} from "../../src/index.js";

/**
 * A port that records calls and resolves. These tests assert what the layer
 * *renders* for a given set of Conversations and capabilities; the interaction
 * round-trip is covered in a real browser by the Playwright suite.
 */
export function stubPort(overrides: Partial<CommentsPort> = {}): CommentsPort {
  const noop = async () => {};
  return {
    displayName: null,
    canModerate: false,
    addComment: noop,
    editComment: noop,
    deleteComment: noop,
    toggleReaction: noop,
    setResolved: noop,
    promote: noop,
    deleteConversation: noop,
    ...overrides,
  };
}

/** Render a comment-layer subtree to HTML with a stub port in place. */
export function render(children: ComponentChildren, port: CommentsPort = stubPort()): string {
  return renderToString(<CommentsProvider value={port}>{children}</CommentsProvider>);
}

export function identity(over: Partial<Identity> = {}): Identity {
  return { name: "Reviewer Jane", kind: "human", tier: "viewer", source: "native", ...over };
}

export function comment(over: Partial<CommentDTO> = {}): CommentDTO {
  return {
    id: "c1",
    author: identity(),
    body: "This claim needs a citation.",
    createdAt: "2026-07-29T12:00:00.000Z",
    editedAt: null,
    deleted: false,
    mine: false,
    reactions: [],
    ...over,
  };
}

export function conversation(over: Partial<ConversationDTO> = {}): ConversationDTO {
  return {
    id: "v1",
    pagePath: "guide/intro.md",
    anchor: { textQuote: { exact: "the rendered text" } },
    anchorStatus: "live",
    resolved: false,
    resolvedBy: null,
    visibility: "public",
    comments: [comment()],
    ...over,
  };
}

/** How many times `needle` occurs in `html` — for counting rendered cards/chips. */
export function occurrences(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

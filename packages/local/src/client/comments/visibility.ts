// Splitting the comment layer into public Threads and private Chats.
//
// Kept out of conversations.ts so the client bundle can import it without
// pulling in @scholia/core, which carries Node.js built-ins. This module
// only imports from @scholia/ui — a dependency the client already bundles.
//
// Both the server render (layout.tsx) and the hydrated island (CommentLayer)
// need the same split, because a rail that divided them differently on the
// two sides would be a hydration correction the reader can see (ADR-0031).

import type { ConversationDTO } from "@scholia/ui";

/**
 * The rail's two lists: public Threads, and the reader's private Chats.
 *
 * Here rather than in each caller because both the server render and the
 * hydrated island need the same split, and a rail that divided them differently
 * on the two sides would be a hydration correction the reader can see
 * (ADR-0031). Locally every Chat in the tree is the reader's — there is one
 * person at this machine and the files are theirs (CONTEXT "Viewer").
 */
export function splitByVisibility(conversations: ConversationDTO[]): {
  threads: ConversationDTO[];
  chats: ConversationDTO[];
} {
  return {
    threads: conversations.filter((c) => c.visibility === "public"),
    chats: conversations.filter((c) => c.visibility === "private"),
  };
}

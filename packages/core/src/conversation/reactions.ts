// The fixed reaction palette (CONTEXT "Reaction").
//
// Review-oriented and closed: no free picker, so a Reaction always means one of
// six things and an agent can be told the whole vocabulary in one line.
//
// `@scholia/ui` carries the same six literals rather than importing them. It
// depends on nothing but Preact on purpose (ADR-0030), and core's dependency
// tree — shiki, katex, the S3 client — has no business inside a comment layer
// that has to run anywhere. `packages/local/test/conversations.test.ts` depends
// on both and asserts the two lists are identical, so the copy cannot drift.

export const REACTION_PALETTE = ["👍", "👎", "✅", "👀", "🎉", "❤️"] as const;

export type ReactionEmoji = (typeof REACTION_PALETTE)[number];

export function isReactionEmoji(emoji: string): emoji is ReactionEmoji {
  return (REACTION_PALETTE as readonly string[]).includes(emoji);
}

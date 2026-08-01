import { useState } from "preact/hooks";
import { useComments } from "./port.js";
import { REACTION_PALETTE, type ReactionGroup } from "./types.js";

interface ReactionsProps {
  commentId: string;
  reactions: ReactionGroup[];
}

export function Reactions({ commentId, reactions }: ReactionsProps) {
  const port = useComments();
  const [pending, setPending] = useState<string | null>(null);
  // A port that can't record a Reaction is a surface without them (see CommentsPort).
  const canReact = port.toggleReaction !== undefined;

  // Build a map of emoji → ReactionGroup for all palette entries.
  const grouped = new Map<string, ReactionGroup>();
  for (const r of reactions) {
    grouped.set(r.emoji, r);
  }

  async function handleToggle(emoji: string) {
    if (pending || !port.toggleReaction) return;
    setPending(emoji);
    try {
      await port.toggleReaction(commentId, emoji);
    } catch {
      // silently ignore — the chip stays in its current state
    } finally {
      setPending(null);
    }
  }

  // Only render palette entries that have a count > 0, plus allow clicking any.
  const visible = REACTION_PALETTE.filter((emoji) => (grouped.get(emoji)?.count ?? 0) > 0);

  // A surface that can't record a Reaction shows no palette. Existing tallies
  // still render, read-only, because they are part of what the Comment says.
  if (!canReact) {
    if (visible.length === 0) return null;
    return (
      <div class="reactions">
        {visible.map((emoji) => (
          <span key={emoji} class="reaction-chip reaction-chip--static">
            {emoji}
            <span class="reaction-chip__count">{grouped.get(emoji)!.count}</span>
          </span>
        ))}
      </div>
    );
  }

  // Pick the list: full palette when nothing used yet, reacted emoji otherwise.
  const items = visible.length > 0 ? visible : REACTION_PALETTE;

  return (
    <div class="reactions">
      {items.map((emoji) => {
        const group = grouped.get(emoji);
        return (
          <button
            key={emoji}
            class={`reaction-chip${group?.mine ? " reaction-chip--mine" : ""}`}
            title={
              group
                ? `${emoji} ${group.count}${group.mine ? " (you reacted)" : ""}`
                : `React with ${emoji}`
            }
            disabled={pending !== null}
            onClick={() => void handleToggle(emoji)}
          >
            {emoji}
            {group !== undefined && group.count > 0 && (
              <span class="reaction-chip__count">{group.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

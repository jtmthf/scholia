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

  // Build a map of emoji → ReactionGroup for all palette entries.
  const grouped = new Map<string, ReactionGroup>();
  for (const r of reactions) {
    grouped.set(r.emoji, r);
  }

  async function handleToggle(emoji: string) {
    if (pending) return;
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

  if (visible.length === 0) {
    return (
      <div class="reactions">
        {REACTION_PALETTE.map((emoji) => (
          <button
            key={emoji}
            class="reaction-chip"
            title={`React with ${emoji}`}
            disabled={pending !== null}
            onClick={() => void handleToggle(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div class="reactions">
      {visible.map((emoji) => {
        const group = grouped.get(emoji)!;
        return (
          <button
            key={emoji}
            class={`reaction-chip${group.mine ? " reaction-chip--mine" : ""}`}
            title={`${emoji} ${group.count}${group.mine ? " (you reacted)" : ""}`}
            disabled={pending !== null}
            onClick={() => void handleToggle(emoji)}
          >
            {emoji}
            <span class="reaction-chip__count">{group.count}</span>
          </button>
        );
      })}
    </div>
  );
}

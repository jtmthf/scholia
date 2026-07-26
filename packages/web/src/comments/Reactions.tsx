import { useState } from "preact/hooks";
import { REACTION_PALETTE, toggleReaction, type ReactionGroup } from "../api";

interface ReactionsProps {
  slug: string;
  commentId: string;
  reactions: ReactionGroup[];
  viewerId: string | null;
  displayName: string;
  onUpdated: (reactions: ReactionGroup[]) => void;
  onNeedViewer: () => Promise<{ viewerId: string; displayName: string }>;
}

export function Reactions({ slug, commentId, reactions, onUpdated, onNeedViewer }: ReactionsProps) {
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
      const { viewerId, displayName } = await onNeedViewer();
      const updated = await toggleReaction(slug, commentId, emoji, {
        viewerId,
        displayName,
      });
      onUpdated(updated);
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

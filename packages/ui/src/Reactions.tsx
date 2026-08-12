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
  const [pickerOpen, setPickerOpen] = useState(false);
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
    setPickerOpen(false);
  }

  // The tallies: palette entries someone has actually used.
  const used = REACTION_PALETTE.filter((emoji) => (grouped.get(emoji)?.count ?? 0) > 0);

  // A surface that can't record a Reaction shows no palette. Existing tallies
  // still render, read-only, because they are part of what the Comment says.
  if (!canReact) {
    if (used.length === 0) return null;
    return (
      <div class="reactions">
        {used.map((emoji) => (
          <span
            key={emoji}
            class="reaction-chip reaction-chip--static"
            title={grouped.get(emoji)!.authors.join(", ")}
          >
            {emoji}
            <span class="reaction-chip__count">{grouped.get(emoji)!.count}</span>
          </span>
        ))}
      </div>
    );
  }

  // Palette entries nobody has used yet — what the add-reaction chip reveals.
  // Emoji already tallied above are reachable by clicking their own chip, so
  // they're left out here rather than offered a second time.
  const remaining = REACTION_PALETTE.filter((emoji) => !used.includes(emoji));

  return (
    <div class="reactions">
      {used.map((emoji) => {
        const group = grouped.get(emoji)!;
        return (
          <button
            key={emoji}
            class={`reaction-chip${group.mine ? " reaction-chip--mine" : ""}`}
            aria-pressed={group.mine}
            title={group.authors.join(", ")}
            disabled={pending !== null}
            onClick={() => void handleToggle(emoji)}
          >
            {emoji}
            <span class="reaction-chip__count">{group.count}</span>
          </button>
        );
      })}
      {remaining.length > 0 && (
        <button
          class="reaction-chip reaction-chip--add"
          aria-expanded={pickerOpen}
          aria-haspopup="true"
          aria-label="Add reaction"
          title="Add reaction"
          onClick={() => setPickerOpen((open) => !open)}
        >
          +
        </button>
      )}
      {pickerOpen &&
        remaining.map((emoji) => (
          <button
            key={emoji}
            class="reaction-chip"
            aria-pressed={false}
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

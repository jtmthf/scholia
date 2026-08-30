import { useState } from "preact/hooks";
import { useComments } from "./port.js";
import type { FormAction } from "./port.js";
import { REACTION_PALETTE, type ReactionGroup } from "./types.js";

interface ReactionsProps {
  commentId: string;
  reactions: ReactionGroup[];
}

interface ReactionButtonProps {
  emoji: string;
  reactionAction?: FormAction | null;
  pending: string | null;
  mine?: boolean;
  count?: number;
  authors?: string[];
  onToggle: (emoji: string) => void | Promise<void>;
}

function ReactionButton({
  emoji,
  reactionAction,
  pending,
  mine,
  count,
  authors,
  onToggle,
}: ReactionButtonProps) {
  if (!reactionAction) {
    return (
      <button
        key={emoji}
        class={`reaction-chip${mine ? " reaction-chip--mine" : ""}`}
        aria-pressed={mine}
        title={authors?.join(", ")}
        disabled={pending !== null}
        onClick={() => void onToggle(emoji)}
      >
        {emoji}
        {count !== undefined && <span class="reaction-chip__count">{count}</span>}
      </button>
    );
  }
  return (
    <form
      key={emoji}
      class="reaction-form"
      action={reactionAction.action}
      method={reactionAction.method}
      onSubmit={(e) => {
        e.preventDefault();
        void onToggle(emoji);
      }}
    >
      {reactionAction.hidden.map((field) => (
        <input key={field.name} type="hidden" name={field.name} value={field.value} />
      ))}
      <input type="hidden" name="emoji" value={emoji} />
      <input type="hidden" name="on" value={mine ? "false" : "true"} />
      <button
        class={`reaction-chip${mine ? " reaction-chip--mine" : ""}`}
        aria-pressed={mine}
        title={authors?.join(", ")}
        disabled={pending !== null}
        type="submit"
      >
        {emoji}
        {count !== undefined && <span class="reaction-chip__count">{count}</span>}
      </button>
    </form>
  );
}

export function Reactions({ commentId, reactions }: ReactionsProps) {
  const port = useComments();
  const [pending, setPending] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // A port that can't record a Reaction is a surface without them (see CommentsPort).
  const canReact = port.toggleReaction !== undefined;
  const reactionAction = port.formAction?.("react", commentId);

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

  const buttonProps = {
    reactionAction,
    pending,
    onToggle: handleToggle,
  };

  return (
    <div class="reactions">
      {used.map((emoji) => {
        const group = grouped.get(emoji)!;
        return (
          <ReactionButton
            key={emoji}
            emoji={emoji}
            mine={group.mine}
            count={group.count}
            authors={group.authors}
            {...buttonProps}
          />
        );
      })}
      {reactionAction
        ? remaining.map((emoji) => <ReactionButton key={emoji} emoji={emoji} {...buttonProps} />)
        : remaining.length > 0 && (
            <>
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
              {pickerOpen &&
                remaining.map((emoji) => (
                  <ReactionButton key={emoji} emoji={emoji} {...buttonProps} />
                ))}
            </>
          )}
    </div>
  );
}

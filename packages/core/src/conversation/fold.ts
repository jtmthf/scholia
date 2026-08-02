// The fold: an append-only event stream read back as a Conversation
// (ADR-0019, ADR-0032).
//
// This is the only place that knows what an event *means*, which is why it lives
// in core rather than in the Sidecar adapter: the adapter's job is bytes on disk,
// and the same rules have to hold for a Postgres-backed stream.
//
// Everything here is written for one property — **the result must not depend on
// the order or the multiplicity of the events**. Git's union merge controls
// neither: it keeps both sides' documents, in whatever order the diff produced,
// and a cherry-pick or rebase can deliver the same event twice. So the fold
// dedupes by event id, sorts into a total order before interpreting anything,
// and resolves every conflict by last-write-wins on that order.
//
// The one rule that is not last-write-wins is deletion, which is absorbing: a
// tombstone cannot be undone by a later edit. An edit that could resurrect a
// deleted body would mean text somebody removed reappearing on merge.

import { REACTION_PALETTE } from "./reactions.js";
import type {
  Comment,
  Conversation,
  ConversationEvent,
  ConversationHeader,
  Reaction,
} from "./types.js";

/**
 * Code-unit order, not `localeCompare`.
 *
 * Everything this file sorts is sorted to make the fold reproducible, and
 * `localeCompare` is the wrong tool for that: with no locale argument it uses
 * the runtime's default collation, so two machines with different ICU data can
 * disagree — which is exactly the property the fold exists to deny. `<` compares
 * UTF-16 code units and is the same everywhere.
 */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The total order events are interpreted in.
 *
 * Timestamps first, because file position means nothing after a union merge
 * (ADR-0019). Ids break ties: they are UUIDv7, so two events written in the same
 * millisecond still sort the same way on every machine that reads the stream.
 */
function byTimestampThenId(a: ConversationEvent, b: ConversationEvent): number {
  return compare(a.timestamp, b.timestamp) || compare(a.id, b.id);
}

/**
 * Who is currently reacting, nested rather than keyed on a joined string: an
 * author name is whatever `git config user.name` says, so there is no separator
 * character it is guaranteed not to contain.
 *
 * Comment id -> emoji -> author -> still reacting.
 */
type ReactionState = Map<string, Map<string, Map<string, boolean>>>;

function recordReaction(
  state: ReactionState,
  target: string,
  emoji: string,
  author: string,
  on: boolean,
): void {
  let emojis = state.get(target);
  if (!emojis) state.set(target, (emojis = new Map()));
  let authors = emojis.get(emoji);
  if (!authors) emojis.set(emoji, (authors = new Map()));
  authors.set(author, on);
}

/**
 * Fold a Conversation's event stream into the Conversation a reader sees.
 *
 * Unknown event types are skipped rather than rejected: a Sidecar committed to
 * git can be read by an older Scholia than the one that wrote it, and a stream
 * carrying an event this version has no opinion about is still a readable
 * Conversation.
 */
export function foldConversation(
  header: ConversationHeader,
  events: ConversationEvent[],
): Conversation {
  // Dedup by id first, then order. Doing it in this order means a duplicate can
  // never displace its original, whichever copy the merge put first.
  const unique = new Map<string, ConversationEvent>();
  for (const event of events) {
    if (!unique.has(event.id)) unique.set(event.id, event);
  }
  const ordered = [...unique.values()].sort(byTimestampThenId);

  const comments = new Map<string, Comment>();
  const edits = new Map<string, { body: string; at: string }>();
  const tombstones = new Set<string>();
  const reactions: ReactionState = new Map();
  let resolution: { resolved: boolean; author: string; at: string } | null = null;

  for (const event of ordered) {
    switch (event.type) {
      case "comment":
        comments.set(event.id, {
          id: event.id,
          conversationId: header.id,
          author: event.author,
          body: event.body,
          timestamp: event.timestamp,
          editedAt: null,
          deleted: false,
          reactions: [],
        });
        break;

      // Later wins by construction: `ordered` is sorted, so the last assignment
      // is the last event.
      case "edited":
        edits.set(event.target, { body: event.body, at: event.timestamp });
        break;

      case "deleted":
        tombstones.add(event.target);
        break;

      case "reacted":
        recordReaction(reactions, event.target, event.emoji, event.author, true);
        break;

      case "unreacted":
        recordReaction(reactions, event.target, event.emoji, event.author, false);
        break;

      case "resolved":
        resolution = { resolved: true, author: event.author, at: event.timestamp };
        break;

      case "reopened":
        resolution = { resolved: false, author: event.author, at: event.timestamp };
        break;
    }
  }

  function reactionsFor(commentId: string): Reaction[] {
    const emojis = reactions.get(commentId);
    if (!emojis) return [];
    // Palette order, not the order they were added: the rail renders these
    // left to right, and a chip that moves when someone else reacts is noise.
    // An emoji nobody is left reacting with drops out entirely.
    const groups: Reaction[] = [];
    for (const emoji of REACTION_PALETTE) {
      const authors = [...(emojis.get(emoji) ?? new Map())]
        .filter(([, on]) => on)
        .map(([author]) => author)
        .sort(compare);
      if (authors.length > 0) groups.push({ emoji, authors });
    }
    return groups;
  }

  const folded = [...comments.values()].sort(
    (a, b) => compare(a.timestamp, b.timestamp) || compare(a.id, b.id),
  );

  for (const comment of folded) {
    // A tombstone is applied last and overrides everything: an edit, a reaction
    // and the body itself all go with it.
    if (tombstones.has(comment.id)) {
      comment.body = "";
      comment.deleted = true;
      continue;
    }
    const edit = edits.get(comment.id);
    if (edit) {
      comment.body = edit.body;
      comment.editedAt = edit.at;
    }
    comment.reactions = reactionsFor(comment.id);
  }

  return {
    header,
    comments: folded,
    resolved: resolution?.resolved ?? false,
    // Only a `resolved` event names anyone: a reopened Conversation has nobody
    // who resolved it, which is the state the rail shows.
    resolvedBy: resolution?.resolved ? resolution.author : null,
    resolvedAt: resolution?.resolved ? resolution.at : null,
    // The Conversation's own id as a target is the whole aggregate going.
    deleted: tombstones.has(header.id),
  };
}

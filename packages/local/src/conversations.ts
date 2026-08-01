// Local Preview's half of the comment layer: turning a browser selection into an
// Anchor, and turning what the Sidecar stores into what @scholia/ui renders.
//
// The mapping is the seam ADR-0030 describes. `@scholia/ui` knows nothing about
// Sites, tokens or Versions; the Sidecar knows nothing about DTOs. Everything
// that is specifically *local* about a Conversation is in this file.

import {
  mapSmIdsToSourceRange,
  type Anchor,
  type Conversation,
  type SourceMap,
} from "@scholia/core";
import type { ConversationDTO, Identity } from "@scholia/ui";

/**
 * A selection as the browser captured it (`@scholia/bridge`'s
 * `SelectionCandidate`), before the Source Map has been applied. Declared
 * structurally so this module doesn't depend on the browser half.
 */
export interface SelectionInput {
  quote: { exact: string; prefix?: string; suffix?: string };
  /** `data-sm` ids the selection intersected, if the Page has a Source Map. */
  smIds?: number[];
  xpath?: string;
  css?: string;
}

/**
 * Build the Anchor to store from what the browser selected.
 *
 * The text-quote arrives already expanded to be unique against the rendered text
 * — that happens at capture, in the DOM, because that is the only place the
 * rendered text exists (ADR-0002, and ADR-0029 "anchors resolve against rendered text"). What this adds is the secondary
 * structural hints, which need the Source Map and therefore the server: the
 * `data-sm` ids the selection touched become a coarse range in the Source.
 */
export function anchorFromSelection(
  selection: SelectionInput,
  sourceMap: SourceMap | null,
): Anchor {
  const exact = selection.quote.exact;
  const sourceRange =
    sourceMap && selection.smIds?.length
      ? mapSmIdsToSourceRange(selection.smIds, sourceMap)
      : undefined;

  return {
    textQuote: {
      exact,
      ...(selection.quote.prefix ? { prefix: selection.quote.prefix } : {}),
      ...(selection.quote.suffix ? { suffix: selection.quote.suffix } : {}),
    },
    ...(sourceRange ? { sourceRange } : {}),
    ...(selection.xpath ? { xpath: selection.xpath } : {}),
    ...(selection.css ? { css: selection.css } : {}),
  };
}

// Local Preview draws no tier distinction. The Sidecar stores an author name and
// nothing else — there is no Viewer record to consult, and the Owner/Viewer split
// only becomes observable once a Tunnel has guests (CONTEXT "Tunnel", issue #31).
// Everyone is rendered as a plain human Viewer, which is quiet and true.
function identityFor(author: string): Identity {
  return { name: author, kind: "human", tier: "viewer", source: "native" };
}

/**
 * Map a stored Conversation onto what the comment layer renders.
 *
 * Two fields are still pinned rather than derived, and each is another ticket:
 * `anchorStatus` is always "live" because continuous re-resolution and Outdated
 * are issue #30; `visibility` is always public because Chats live in a separate
 * directory that does not exist yet (issue #31).
 */
export function toConversationDTO(conversation: Conversation, reader: string): ConversationDTO {
  return {
    id: conversation.header.id,
    pagePath: conversation.header.page,
    anchor: conversation.header.anchor,
    anchorStatus: "live",
    resolved: conversation.resolved,
    resolvedBy: conversation.resolvedBy,
    visibility: "public",
    comments: conversation.comments.map((comment) => ({
      id: comment.id,
      author: identityFor(comment.author),
      body: comment.body,
      createdAt: comment.timestamp,
      editedAt: comment.editedAt,
      deleted: comment.deleted,
      mine: comment.author === reader,
      // The rail counts reactions and asks whether the reader is among them;
      // who else reacted is in the Sidecar for anyone reading the file.
      reactions: comment.reactions.map((reaction) => ({
        emoji: reaction.emoji,
        count: reaction.authors.length,
        mine: reaction.authors.includes(reader),
      })),
    })),
  };
}

/**
 * Every Conversation on a Page, oldest first.
 *
 * Ordering is by creation because the rail has no rendered document to measure
 * against — the browser reorders anchored cards by where their Anchor actually
 * resolved once it has one.
 */
export function toConversationDTOs(
  conversations: Conversation[],
  reader: string,
): ConversationDTO[] {
  return conversations
    .map((conversation) => toConversationDTO(conversation, reader))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The Page path a Conversation is filed under: repo-relative, no leading slash —
 * the same shape a hosted `ManifestEntry` uses, so a Conversation promoted to a
 * Site keeps its Page identity (CONTEXT "Page": identity is the path).
 */
export function toPagePath(urlPath: string): string {
  return urlPath.replace(/^\/+/, "");
}

// Local Preview's half of the comment layer: turning a browser selection into an
// Anchor, and turning what the Sidecar stores into what @scholia/ui renders.
//
// The mapping is the seam ADR-0030 describes. `@scholia/ui` knows nothing about
// Sites, tokens or Versions; the Sidecar knows nothing about DTOs. Everything
// that is specifically *local* about a Conversation is in this file.

import {
  mapSmIdsToSourceRange,
  migrateAnchor,
  type Anchor,
  type AnchorStatus,
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
 * Whether an Anchor still finds its passage in the Page as it now stands.
 *
 * Hosted settles this once, at an upload boundary against an immutable Version.
 * Locally the files are live, so there is nothing to settle: Outdated is computed
 * on every read (ADR-0018), from the original Anchor, which is never rewritten —
 * that is what lets an Outdated card go on showing what the passage used to say.
 *
 * `migrateAnchor` is the hosted matcher, called here unchanged so the two paths
 * cannot drift apart: one behaviour means a Conversation cannot flip to Outdated
 * the moment it is shared (ADR-0029). Only its verdict is taken. The Anchor it
 * migrates forward is discarded, because there is nowhere for it to go — the
 * Sidecar's header is written once, and under literal matching a successful
 * match leaves the quote identical anyway.
 *
 * `pageText` is null when there is no Page to judge against: a render that
 * failed, or a Conversation filed against a path with no file behind it. Nothing
 * is claimed in that case, because declaring a Conversation Outdated on the
 * strength of a Page we could not read would be crying wolf.
 */
function anchorStatusFor(anchor: Anchor | null, pageText: string | null): AnchorStatus {
  if (!anchor || pageText === null) return "live";
  return migrateAnchor(anchor, pageText).status;
}

/**
 * Map a stored Conversation onto what the comment layer renders.
 *
 * `pageText` is the Page's *rendered* text — the layer the quote was captured
 * from, and the only one it can be re-resolved against (ADR-0029).
 *
 * `visibility` is always public because Chats live in a separate directory that
 * does not exist yet (issue #31).
 */
export function toConversationDTO(
  conversation: Conversation,
  reader: string,
  pageText: string | null,
): ConversationDTO {
  return {
    id: conversation.header.id,
    pagePath: conversation.header.page,
    anchor: conversation.header.anchor,
    anchorStatus: anchorStatusFor(conversation.header.anchor, pageText),
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
  pageText: string | null,
): ConversationDTO[] {
  return conversations
    .map((conversation) => toConversationDTO(conversation, reader, pageText))
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

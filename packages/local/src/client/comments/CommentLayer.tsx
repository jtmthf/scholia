// The comment layer's one interactive island (ADR-0011, ADR-0030).
//
// Its first render is deliberately identical to what the server already sent —
// the rail and nothing else — because that is the markup it hydrates. Everything
// beyond it (the affordance a selection raises, the composer it opens) is state
// that only a reader's gesture can produce, and so cannot exist on the server.

import { useEffect, useMemo, useState } from "preact/hooks";
import { CommentsProvider, Rail, type CommentsPort, type ConversationDTO } from "@scholia/ui";
import type { SelectionCandidate } from "@scholia/bridge";
import { EMPTY_NOTE, OUTDATED_NOTE } from "../../render/comment-copy.js";
import * as api from "./api.js";
import { useContentAnchors, type ViewportPoint } from "./use-content-anchors.js";
import { NewConversationComposer } from "./NewConversationComposer.js";
import { SelectionAction } from "./SelectionAction.js";

export interface CommentsData {
  pagePath: string;
  contentHash: string;
  displayName: string;
  /** Whether this reader is the Owner, decided by the server per request. */
  canModerate: boolean;
  conversations: ConversationDTO[];
}

interface CommentLayerProps {
  data: CommentsData;
  /** The element holding the Page's content — where selections come from. */
  content: Element | null;
}

/** A Conversation being written but not yet posted. */
interface Draft {
  /** null for a Page-level Conversation. */
  selection: SelectionCandidate | null;
  at?: ViewportPoint;
}

export function CommentLayer({ data, content }: CommentLayerProps) {
  const [conversations, setConversations] = useState(data.conversations);
  const [draft, setDraft] = useState<Draft | null>(null);

  // A live reload re-renders this island with a fresh `data` from the server, so
  // the Conversations it was mounted with have to give way to the ones the
  // server just sent. Without this the rail would keep showing what was true
  // when the page first loaded while the content changed around it.
  useEffect(() => setConversations(data.conversations), [data.conversations]);

  const { selection, clearSelection, activeConversationId, activate, anchorOffsets } =
    useContentAnchors({ content, contentKey: data.contentHash, conversations });

  // `@scholia/ui` addresses a Comment by its own id, because that is all a
  // Comment card knows about itself. The Sidecar is keyed by Conversation — one
  // file per aggregate (ADR-0019) — so the id of the thread a Comment sits in is
  // recovered here, from the Conversations the rail is already rendering.
  function conversationOf(commentId: string): string {
    const owner = conversations.find((c) => c.comments.some((cm) => cm.id === commentId));
    if (!owner) throw new Error("That comment is no longer on this page. Reload and try again.");
    return owner.id;
  }

  const port = useMemo<CommentsPort>(
    () => ({
      // Git already knows who the reader is (CONTEXT "Identity"), so the Composer
      // never has to ask — which is the whole of identity on the local path.
      displayName: data.displayName,
      // The server decided this per request: the reader at this machine is the
      // Owner, a Tunnel guest is not (CONTEXT "Owner", ADR-0022).
      canModerate: data.canModerate,
      async addComment(conversationId, { body }) {
        setConversations(await api.addComment({ pagePath: data.pagePath, conversationId, body }));
      },
      // Editing and deleting a Comment are the Owner's alone here, and so are
      // absent for anyone else rather than present and refused (ADR-0030,
      // ADR-0017's "no broken buttons"). The server gates them the same way,
      // because `author` is one name for every writer on this machine: until a
      // Tunnel guest has an Identity of their own (issue #31), "my Comment" and
      // "the host's Comment" are indistinguishable, so touching words already
      // written stays with the reader at this machine.
      ...(data.canModerate
        ? {
            async editComment(commentId: string, { body }: { body: string }) {
              setConversations(
                await api.editComment({
                  pagePath: data.pagePath,
                  conversationId: conversationOf(commentId),
                  commentId,
                  body,
                }),
              );
            },
            async deleteComment(commentId: string) {
              setConversations(
                await api.deleteComment({
                  pagePath: data.pagePath,
                  conversationId: conversationOf(commentId),
                  commentId,
                }),
              );
            },
          }
        : {}),
      async toggleReaction(commentId, emoji) {
        setConversations(
          await api.toggleReaction({
            pagePath: data.pagePath,
            conversationId: conversationOf(commentId),
            commentId,
            emoji,
          }),
        );
      },
      async setResolved(conversationId, resolved) {
        setConversations(
          await api.setResolved({ pagePath: data.pagePath, conversationId, resolved }),
        );
      },
      async deleteConversation(conversationId) {
        setConversations(await api.deleteConversation({ pagePath: data.pagePath, conversationId }));
      },
      // `promote` stays absent, and @scholia/ui reads that as "this surface
      // doesn't have it": there is nothing to promote to until Chats exist
      // (issue #31).
    }),
    // `conversations` is a dependency because `conversationOf` reads it — a port
    // closed over a stale list would look up a Comment in a rail that has moved on.
    [data.pagePath, data.displayName, data.canModerate, conversations],
  );

  async function submitDraft(body: string): Promise<void> {
    setConversations(
      await api.createConversation({
        pagePath: data.pagePath,
        body,
        selection: draft?.selection ?? null,
        // The hash the server computed when it rendered this Page, handed back
        // untouched: the Comment binds to the bytes the reader was looking at,
        // not to whatever is on disk now (CONTEXT "Comment").
        contentHash: data.contentHash,
      }),
    );
    setDraft(null);
    clearSelection();
  }

  // A Conversation sits beside the passage it is about: anchored cards follow
  // the order their Anchors resolved to in the document, and one whose Anchor
  // did not resolve keeps its place at the end rather than jumping to the top.
  const ordered = useMemo(() => {
    return [...conversations].sort((a, b) => {
      const av = anchorOffsets[a.id] ?? Number.POSITIVE_INFINITY;
      const bv = anchorOffsets[b.id] ?? Number.POSITIVE_INFINITY;
      return av - bv || a.id.localeCompare(b.id);
    });
  }, [conversations, anchorOffsets]);

  return (
    <CommentsProvider value={port}>
      <Rail
        conversations={ordered}
        chats={[]}
        activeConversationId={activeConversationId}
        onActivate={activate}
        onNewPageComment={() => setDraft({ selection: null })}
        outdatedNote={OUTDATED_NOTE}
        emptyNote={EMPTY_NOTE}
      />
      {selection && !draft && (
        <SelectionAction
          at={selection.at}
          onComment={() => setDraft({ selection: selection.candidate, at: selection.at })}
        />
      )}
      {draft && (
        <NewConversationComposer
          anchored={draft.selection !== null}
          at={draft.at}
          displayName={data.displayName}
          onSubmit={submitDraft}
          onCancel={() => {
            setDraft(null);
            clearSelection();
          }}
        />
      )}
    </CommentsProvider>
  );
}

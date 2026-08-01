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

  const port = useMemo<CommentsPort>(
    () => ({
      // Git already knows who the reader is (CONTEXT "Identity"), so the Composer
      // never has to ask — which is the whole of identity on the local path.
      displayName: data.displayName,
      canModerate: false,
      async addComment(conversationId, { body }) {
        setConversations(await api.addComment({ pagePath: data.pagePath, conversationId, body }));
      },
      // Everything else is deliberately absent, and @scholia/ui reads that as
      // "this surface doesn't have it": resolve/reopen and reactions are events
      // the Sidecar cannot write yet (issue #32), and there is nothing to promote
      // to until Chats exist (issue #31).
    }),
    [data.pagePath, data.displayName],
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

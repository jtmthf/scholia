// The comment layer's one interactive island (ADR-0011, ADR-0030).
//
// Its first render is deliberately identical to what the server already sent —
// the rail and nothing else — because that is the markup it hydrates. Everything
// beyond it (the affordance a selection raises, the composer it opens) is state
// that only a reader's gesture can produce, and so cannot exist on the server.

import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { CommentsProvider, Rail, type CommentsPort, type ConversationDTO } from "@scholia/ui";
import type { SelectionCandidate } from "@scholia/bridge";
import { EMPTY_NOTE, OUTDATED_NOTE } from "../../render/comment-copy.js";
import { liveReloadGate } from "../live-reload.js";
import * as api from "./api.js";
import { useContentAnchors } from "./use-content-anchors.js";
import { ContentChangedNotice } from "./ContentChangedNotice.js";
import { NewConversationComposer } from "./NewConversationComposer.js";
import { SelectionAction } from "./SelectionAction.js";
import { pageDrafts } from "./drafts.js";
import type { Draft } from "./drafts.js";

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

export function CommentLayer({ data, content }: CommentLayerProps) {
  const [conversations, setConversations] = useState(data.conversations);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Whether the reader is actually *in* the open Composer. False for a draft
  // restored from a previous life of the tab, which they have not come back to
  // yet — see the hold below.
  const [engaged, setEngaged] = useState(false);
  const [contentChanged, setContentChanged] = useState(false);

  // A live reload re-renders this island with a fresh `data` from the server, so
  // the Conversations it was mounted with have to give way to the ones the
  // server just sent. Without this the rail would keep showing what was true
  // when the page first loaded while the content changed around it.
  useEffect(() => setConversations(data.conversations), [data.conversations]);

  const {
    selection,
    clearSelection,
    activeConversationId,
    activate,
    anchorOffsets,
    unresolvedAnchors,
  } = useContentAnchors({ content, contentKey: data.contentHash, conversations });

  // ---- Composing holds the ground still (issue #29) --------------------------
  //
  // A selection points into the rendered DOM and a Composer is open over it, so
  // a content swap would take both away mid-sentence. While either is live the
  // gate holds the swap; the reader is told one is waiting and can take it, and
  // it lands by itself the moment they are no longer composing.
  //
  // A *restored* draft does not count until the reader engages with it. It is
  // words from an earlier life of the tab, not someone mid-sentence, and left to
  // count it would suppress live reload on every later visit to the Page until
  // it happened to be cancelled. Nothing is at risk either way: a swap
  // re-renders this island rather than remounting it, so an open Composer and
  // its text survive one regardless.

  const composing = selection !== null || (draft !== null && engaged);

  useEffect(() => {
    const gate = liveReloadGate();
    if (!gate) return;
    gate.setHold(composing);
    // Releasing on unmount matters: the island going away is the surest sign
    // nothing is being composed.
    return () => gate.setHold(false);
  }, [composing]);

  useEffect(() => {
    const gate = liveReloadGate();
    if (!gate) return;
    const sync = (): void => setContentChanged(gate.pending());
    sync();
    return gate.subscribe(sync);
  }, []);

  // ---- Drafts outlive the page they are written on ---------------------------

  const drafts = useMemo(() => pageDrafts(data.pagePath), [data.pagePath]);

  // Every keystroke goes to storage but not to state: the Composer owns the text
  // it is showing, and re-rendering the layer per character would be re-rendering
  // the rail per character for nothing. `body` on the Draft is what the Composer
  // *started* with, which is the only part this side needs to know.
  function persistBody(body: string): void {
    if (!draft) return;
    // Typing in a restored draft is the reader coming back to it.
    setEngaged(true);
    drafts.save({ ...draft, body });
  }

  const discardDraft = useCallback((): void => {
    if (draft) drafts.clear(draft.selection);
    setDraft(null);
    setEngaged(false);
  }, [draft, drafts]);

  // Restore whatever was being written here. Only reached when the island was
  // torn down and rebuilt — a swap re-renders it, and a re-render keeps its
  // state — so this is the full-reload path: the swap's own fallback, or a
  // refresh. Once, on mount: after that the Composer is the source of truth.
  useEffect(() => {
    const restored = drafts.latest();
    if (restored) {
      const { savedAt: _savedAt, ...draft } = restored;
      setDraft(draft);
    }
  }, []);

  /** Open the Composer on a passage, resuming any draft already written about it. */
  function composeOn(candidate: SelectionCandidate | null, at?: Draft["at"]): void {
    setDraft({
      selection: candidate,
      body: drafts.load(candidate)?.body ?? "",
      // The render this draft is about. Held here rather than read at submit,
      // because taking a live reload mid-draft changes what `data` says.
      contentHash: data.contentHash,
      ...(at ? { at } : {}),
    });
    setEngaged(true);
  }

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

  // Submitting always succeeds (issue #29). The file may well have changed while
  // this was being written — that is the normal case here, not a race to guard
  // against — and the Anchor is a text-quote, which is self-describing: the
  // passage is found wherever it moved, and if it is gone the Conversation is
  // Outdated with its original quote intact. Refusing the Comment instead would
  // lose it in the one moment the reader had something worth saying, and could
  // not be made correct anyway, since the file can change between check and write.
  async function submitDraft(body: string): Promise<void> {
    setConversations(
      await api.createConversation({
        pagePath: data.pagePath,
        body,
        selection: draft?.selection ?? null,
        // The hash the server computed when it rendered the Page this draft was
        // started on, handed back untouched: the Comment binds to the bytes the
        // reader was looking at when they selected, not to whatever is on disk
        // now, and not to a later render they took mid-draft (CONTEXT "Comment").
        contentHash: draft?.contentHash ?? data.contentHash,
      }),
    );
    discardDraft();
    clearSelection();
  }

  // A Conversation sits beside the passage it is about: anchored cards follow
  // the order their Anchors resolved to in the document, and one whose Anchor
  // did not resolve keeps its place at the end rather than jumping to the top.
  //
  // That same failure to resolve is what makes a Conversation Outdated: locally
  // the file is live, so there is no stored status to read — Outdated is the
  // answer to "does this quote still match the text as it now stands" (ADR-0018,
  // CONTEXT "Outdated"). The stored Anchor is never rewritten, which is what
  // lets the card go on showing what the passage used to say.
  const ordered = useMemo(() => {
    return [...conversations]
      .sort((a, b) => {
        const av = anchorOffsets[a.id] ?? Number.POSITIVE_INFINITY;
        const bv = anchorOffsets[b.id] ?? Number.POSITIVE_INFINITY;
        return av - bv || a.id.localeCompare(b.id);
      })
      .map((c) => (unresolvedAnchors.has(c.id) ? { ...c, anchorStatus: "outdated" as const } : c));
  }, [conversations, anchorOffsets, unresolvedAnchors]);

  return (
    <CommentsProvider value={port}>
      <Rail
        conversations={ordered}
        chats={[]}
        activeConversationId={activeConversationId}
        onActivate={activate}
        onNewPageComment={() => composeOn(null)}
        outdatedNote={OUTDATED_NOTE}
        emptyNote={EMPTY_NOTE}
      />
      {selection && !draft && (
        <SelectionAction
          at={selection.at}
          onComment={() => composeOn(selection.candidate, selection.at)}
        />
      )}
      {draft && (
        <NewConversationComposer
          anchored={draft.selection !== null}
          at={draft.at}
          displayName={data.displayName}
          initialBody={draft.body}
          onBodyChange={persistBody}
          onSubmit={submitDraft}
          onCancel={() => {
            discardDraft();
            clearSelection();
          }}
        />
      )}
      {contentChanged && <ContentChangedNotice onTake={() => liveReloadGate()?.take()} />}
    </CommentsProvider>
  );
}

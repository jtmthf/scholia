// The comment layer's one interactive island (ADR-0011, ADR-0030).
//
// Its first render is deliberately identical to what the server already sent —
// the rail and nothing else — because that is the markup it hydrates. Everything
// beyond it (the affordance a selection raises, the composer it opens) is state
// that only a reader's gesture can produce, and so cannot exist on the server.

import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { CommentsProvider, Rail, type CommentsPort, type ConversationDTO } from "@scholia/ui";
import type { SelectionCandidate } from "@scholia/bridge";
import { CHATS_NOTE, EMPTY_NOTE, OUTDATED_NOTE, PROMOTE_NOTE } from "../../render/comment-copy.js";
import { splitByVisibility } from "./visibility.js";
import { liveReloadGate } from "../live-reload.js";
import * as api from "./api.js";
import { useContentAnchors } from "./use-content-anchors.js";
import { ContentChangedNotice } from "./ContentChangedNotice.js";
import { NewConversationComposer } from "./NewConversationComposer.js";
import { SelectionAction } from "./SelectionAction.js";
import { pageDrafts } from "./drafts.js";
import type { Draft, DraftVisibility } from "./drafts.js";

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

  /**
   * Take what the server just answered a write with.
   *
   * Every `anchorStatus` in that answer is about the Page *as it stands on disk*
   * (issue #30), which is not always the Page on screen: while the reader is
   * composing, a content update is held for them (issue #29). Applying those
   * statuses then would move a card into Outdated and take its highlight off a
   * passage still in front of the reader — the ground moving under someone
   * mid-sentence, which is the thing the hold exists to prevent.
   *
   * So while an update is waiting, a Conversation already in the rail keeps the
   * status it had. Nothing is decided here and nothing is re-resolved — the
   * answer is deferred, and lands with the content it is about the moment the
   * reader takes the update.
   *
   * A Conversation arriving for the first time has no earlier status to keep and
   * takes the one it came with. That is usually the Comment just submitted, and
   * showing it where it is going to stay beats moving it a moment later.
   */
  const receive = useCallback((next: ConversationDTO[]): void => {
    setConversations((prev) => {
      if (!liveReloadGate()?.pending()) return next;
      const held = new Map(prev.map((c) => [c.id, c.anchorStatus]));
      return next.map((c) => {
        const status = held.get(c.id);
        return status ? { ...c, anchorStatus: status } : c;
      });
    });
  }, []);

  const { selection, clearSelection, activeConversationId, activate, emphasize, anchorOffsets } =
    useContentAnchors({ content, contentKey: data.contentHash, conversations });

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
    if (draft) drafts.clear(draft.selection, draft.visibility);
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

  /**
   * Open the Composer on a passage, resuming any draft already written about it
   * *as this kind of Conversation*.
   *
   * Visibility is fixed the moment the reader picks a button and travels with
   * the draft from here to the post: a Chat and a Thread on the same passage are
   * two separate drafts, and neither can turn into the other on the way.
   */
  function composeOn(
    candidate: SelectionCandidate | null,
    visibility: DraftVisibility,
    at?: Draft["at"],
  ): void {
    setDraft({
      selection: candidate,
      body: drafts.load(candidate, visibility)?.body ?? "",
      visibility,
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
        receive(await api.addComment({ pagePath: data.pagePath, conversationId, body }));
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
              receive(
                await api.editComment({
                  pagePath: data.pagePath,
                  conversationId: conversationOf(commentId),
                  commentId,
                  body,
                }),
              );
            },
            async deleteComment(commentId: string) {
              receive(
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
        receive(
          await api.toggleReaction({
            pagePath: data.pagePath,
            conversationId: conversationOf(commentId),
            commentId,
            emoji,
          }),
        );
      },
      async setResolved(conversationId, resolved) {
        receive(await api.setResolved({ pagePath: data.pagePath, conversationId, resolved }));
      },
      async deleteConversation(conversationId) {
        receive(await api.deleteConversation({ pagePath: data.pagePath, conversationId }));
      },
      // Promotion is the Owner's, like editing and deleting: a Chat belongs to
      // the person at this machine, and a Tunnel guest deciding what their
      // host's private conversation says in public is not a thing to offer. The
      // server refuses it on the same test, so an absent method here and a 403
      // there are the same rule stated twice rather than a broken button.
      ...(data.canModerate
        ? {
            async promote(
              conversationId: string,
              input: { commentIds: string[]; summary?: string },
            ) {
              setConversations(
                await api.promote({
                  pagePath: data.pagePath,
                  conversationId,
                  commentIds: input.commentIds,
                  ...(input.summary ? { summary: input.summary } : {}),
                }),
              );
            },
          }
        : {}),
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
    receive(
      await api.createConversation({
        pagePath: data.pagePath,
        body,
        selection: draft?.selection ?? null,
        // The hash the server computed when it rendered the Page this draft was
        // started on, handed back untouched: the Comment binds to the bytes the
        // reader was looking at when they selected, not to whatever is on disk
        // now, and not to a later render they took mid-draft (CONTEXT "Comment").
        contentHash: draft?.contentHash ?? data.contentHash,
        // Whatever the reader chose when they opened this Composer. A draft
        // carrying nothing here can only be a public one — `composeOn` always
        // records it, and a restored draft only keeps the value when it says
        // "private" — so the default cannot post a Chat as a Thread.
        visibility: draft?.visibility ?? "public",
      }),
    );
    discardDraft();
    clearSelection();
  }

  // A Conversation sits beside the passage it is about: anchored cards follow
  // the order their Anchors resolved to in the document, and one that was not
  // painted — Outdated, or a quote the DOM did not find — keeps its place at the
  // end rather than jumping to the top.
  //
  // Which of them are Outdated arrived with the data: locally the file is live,
  // so it is not a stored status but the answer to "does this quote still match
  // the text as it now stands", recomputed by the server on every read through
  // the hosted matcher (ADR-0018, ADR-0029, CONTEXT "Outdated"). The stored
  // Anchor is never rewritten, which is what lets the card go on showing what
  // the passage used to say.
  const ordered = useMemo(() => {
    return [...conversations].sort((a, b) => {
      const av = anchorOffsets[a.id] ?? Number.POSITIVE_INFINITY;
      const bv = anchorOffsets[b.id] ?? Number.POSITIVE_INFINITY;
      return av - bv || a.id.localeCompare(b.id);
    });
  }, [conversations, anchorOffsets]);

  // Threads and Chats are two lists in the rail but one list everywhere else:
  // they anchor, resolve and go Outdated identically, so the ordering pass above
  // runs over both and the split happens last (ADR-0019).
  const { threads, chats } = splitByVisibility(ordered);

  return (
    <CommentsProvider value={port}>
      <Rail
        conversations={threads}
        chats={chats}
        activeConversationId={activeConversationId}
        onActivate={activate}
        onEmphasize={emphasize}
        onNewPageComment={() => composeOn(null, "public")}
        outdatedNote={OUTDATED_NOTE}
        emptyNote={EMPTY_NOTE}
        chatsNote={CHATS_NOTE}
        promoteNote={PROMOTE_NOTE}
        pageLevelComposer={
          draft && !draft.selection ? (
            <NewConversationComposer
              inline
              anchored={false}
              visibility={draft.visibility ?? "public"}
              displayName={data.displayName}
              autoFocus={engaged}
              initialBody={draft.body}
              onBodyChange={persistBody}
              onSubmit={submitDraft}
              onCancel={() => {
                discardDraft();
                clearSelection();
              }}
            />
          ) : undefined
        }
      />
      {selection && !draft && (
        <SelectionAction
          at={selection.at}
          onComment={() => composeOn(selection.candidate, "public", selection.at)}
          onAsk={() => composeOn(selection.candidate, "private", selection.at)}
        />
      )}
      {draft && draft.selection && (
        <NewConversationComposer
          anchored
          // The Composer says which of the two this is, because once it is open
          // over the passage the buttons that distinguished them are gone.
          visibility={draft.visibility ?? "public"}
          at={draft.at}
          quote={draft.selection.quote.exact}
          displayName={data.displayName}
          autoFocus={engaged}
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

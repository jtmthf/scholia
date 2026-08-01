import { useMemo } from "preact/hooks";
import type { CommentsPort } from "@scholia/ui";
import {
  addComment,
  deleteComment,
  editComment,
  ownerDeleteConversation,
  promote,
  setResolved,
  toggleReaction,
} from "../api.js";
import { ensureViewer, setDisplayName } from "../viewer.js";
import { useRefreshConversations } from "./queries.js";
import { useViewer } from "./identity.js";

/**
 * The hosted half of the comment layer's port: it binds the Site slug, resolves the
 * anonymous Viewer, carries the Owner token for moderation, and invalidates the
 * query cache once a mutation lands. Everything hosted-only about commenting is
 * here, which is what lets @scholia/ui stay ignorant of Sites and tokens.
 */
export function useCommentsPort(
  slug: string,
  pagePath: string,
  ownerToken: string | null,
): CommentsPort {
  const viewer = useViewer(slug);
  const displayName = viewer?.displayName ?? null;
  // Every mutation below ends with this, so the components re-render from the
  // server's answer rather than from a guess.
  const refresh = useRefreshConversations(slug, pagePath);

  return useMemo<CommentsPort>(() => {
    // A Viewer is minted on the reader's first *action*, never eagerly, and never
    // just to look (CONTEXT "Viewer" / the viewer.ts contract).
    const acting = async () => {
      const v = await ensureViewer(slug);
      return { viewerId: v.viewerId, storedName: v.displayName ?? "" };
    };

    return {
      displayName,
      canModerate: ownerToken !== null,

      async addComment(conversationId, { body, displayName: typed }) {
        const { viewerId, storedName } = await acting();
        // First comment doubles as "introduce yourself": persist the name they gave.
        if (typed && !storedName) setDisplayName(slug, typed);
        await addComment(slug, conversationId, {
          body,
          viewerId,
          displayName: typed || storedName || "Anonymous",
        });
        await refresh();
      },

      async editComment(commentId, { body }) {
        const { viewerId } = await acting();
        await editComment(slug, commentId, { body, viewerId });
        await refresh();
      },

      async deleteComment(commentId) {
        const { viewerId } = await acting();
        await deleteComment(slug, commentId, viewerId);
        await refresh();
      },

      async toggleReaction(commentId, emoji) {
        const { viewerId, storedName } = await acting();
        await toggleReaction(slug, commentId, emoji, { viewerId, displayName: storedName });
        await refresh();
      },

      async setResolved(conversationId, resolved) {
        const { viewerId, storedName } = await acting();
        await setResolved(slug, conversationId, resolved, {
          viewerId,
          displayName: storedName || "Anonymous",
        });
        await refresh();
      },

      async promote(conversationId, input) {
        const { viewerId } = await acting();
        await promote(slug, conversationId, { ...input, viewerId });
        await refresh();
      },

      async deleteConversation(conversationId) {
        if (!ownerToken) throw new Error("Deleting a Conversation is owner-only.");
        await ownerDeleteConversation(slug, ownerToken, conversationId);
        await refresh();
      },
    };
  }, [refresh, slug, ownerToken, displayName]);
}

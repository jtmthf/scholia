// The local target: the application layer's verb set, in-process (ADR-0020).
//
// No daemon, no port, no discovery file. An agent that can run a command can
// comment in a repository where Scholia has never been started — from CI, from
// a git hook, at 3am with nobody watching. That is the whole reason the CLI and
// MCP invoke the application directly rather than always going over HTTP.
//
// Two writers are therefore normal: this, and a preview server serving the same
// tree. The Sidecar is append-only with UUIDv7 ids and every write is one
// atomic append (ADR-0019), so the two interleave rather than collide — and the
// preview picks an agent's Comment up over its existing watch channel.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  appendComment,
  createConversation,
  deleteComment,
  deleteConversation,
  editComment,
  getProvenance,
  hashBytes,
  listConversations,
  promoteConversation,
  resolveWithinRoot,
  setReaction,
  setResolved,
  toConversationView,
  type ActingAs,
  type Anchor,
  type AuthorKind,
  type CommentInput,
  type CommentRefInput,
  type CommentView,
  type ConversationApi,
  type ConversationRefInput,
  type ConversationView,
  type DeletedResult,
  type EditCommentInput,
  type ListInput,
  type PromoteInput,
  type ReactInput,
  type ReactionResult,
  type ReplyInput,
  type ResolvedResult,
} from "@scholia/core";
import { resolveAuthor } from "./author.js";
import { SidecarStore } from "./store.js";

export interface LocalApiOptions {
  /** The project root the Sidecar lives under. Defaults to the cwd. */
  rootDir?: string;
}

/**
 * The Comment as the folded Conversation holds it — the shape both `reply` and
 * `edit_comment` answer with.
 */
function commentView(conversation: ConversationView, commentId: string): CommentView {
  const found = conversation.comments.find((comment) => comment.id === commentId);
  if (!found) {
    // The fold just wrote it, so this cannot happen from a successful write —
    // it would mean the store accepted an event it then could not read back.
    throw new Error(`Comment ${commentId} is not in Conversation ${conversation.id}`);
  }
  return found;
}

export function createLocalApi(options: LocalApiOptions = {}): ConversationApi {
  const rootDir = resolve(options.rootDir ?? ".");
  const repo = new SidecarStore(rootDir);

  /**
   * Who is acting, and whether they are a person.
   *
   * `--agent` names the agent and marks what it writes as an agent's; without
   * it the author is whoever git says is at this machine. There is nothing to
   * verify against, by design: this is a filesystem the caller already owns,
   * and the Sidecar is a directory they could delete outright.
   */
  async function actingAs(input: ActingAs): Promise<{ author: string; authorKind?: AuthorKind }> {
    const agent = input.agent?.trim();
    if (agent) return { author: agent, authorKind: "agent" };
    return { author: await resolveAuthor(rootDir) };
  }

  // sha256 of the Page's Source, the same hash a hosted Version records for it
  // (`StoredPage.contentHash`), so one binding spans both paths. Returns an
  // empty object — not `{ contentHash: undefined }` — when the path names
  // nothing readable, so the header simply omits the field.
  async function pageContentHash(pagePath: string): Promise<{ contentHash?: string }> {
    const fsPath = resolveWithinRoot(rootDir, pagePath);
    if (!fsPath) return {};
    try {
      return { contentHash: hashBytes(await readFile(fsPath)) };
    } catch {
      return {};
    }
  }

  /** The Conversation a verb just wrote to, folded and viewed. */
  async function view(conversationId: string): Promise<ConversationView> {
    const conversation = await repo.getConversation(conversationId);
    if (!conversation) throw new Error(`no Conversation ${conversationId} in the Sidecar`);
    return toConversationView(conversation);
  }

  async function setResolvedState(
    input: ConversationRefInput,
    resolved: boolean,
  ): Promise<ResolvedResult> {
    await setResolved(repo, {
      conversationId: input.conversation,
      resolved,
      ...(await actingAs(input)),
    });
    return { conversation: input.conversation, resolved };
  }

  return {
    async listConversations(input: ListInput): Promise<ConversationView[]> {
      const conversations = await listConversations(repo, {
        ...(input.page === undefined ? {} : { pagePath: input.page }),
        ...(input.unresolved ? { unresolved: true } : {}),
        ...(input.since === undefined ? {} : { since: input.since }),
        ...(input.mentions === undefined ? {} : { mentions: input.mentions }),
      });
      return conversations.map(toConversationView);
    },

    async listChats(input: ListInput): Promise<ConversationView[]> {
      // Locally the reader owns every Chat in their own tree (CONTEXT
      // "Viewer"), so "your Chats" is simply the private ones.
      const conversations = await listConversations(repo, {
        visibility: "private",
        ...(input.page === undefined ? {} : { pagePath: input.page }),
        ...(input.unresolved ? { unresolved: true } : {}),
        ...(input.since === undefined ? {} : { since: input.since }),
        ...(input.mentions === undefined ? {} : { mentions: input.mentions }),
      });
      return conversations.map(toConversationView);
    },

    async comment(input: CommentInput): Promise<ConversationView> {
      // The --anchor flag is the exact quote; --prefix/--suffix give it context
      // when the quote repeats. Without one the Comment is about the Page.
      const anchor: Anchor | null = input.anchor
        ? {
            textQuote: {
              exact: input.anchor,
              ...(input.prefix ? { prefix: input.prefix } : {}),
              ...(input.suffix ? { suffix: input.suffix } : {}),
            },
          }
        : null;

      const conversation = await createConversation(repo, {
        pagePath: input.page,
        body: input.body,
        anchor,
        ...(await actingAs(input)),
        // Which directory the Sidecar files it under, and the whole of what
        // makes it private (ADR-0019).
        visibility: input.chat ? "private" : "public",
        // The binding and its context (CONTEXT "Comment", ADR-0018). Both are
        // best-effort: `page` is a path, and it need not name a file that
        // exists on this machine or a directory that is a git repository.
        ...(await pageContentHash(input.page)),
        provenance: await getProvenance(rootDir),
      });

      return toConversationView(conversation);
    },

    async reply(input: ReplyInput): Promise<CommentView> {
      // Names no directory: the event goes wherever the Conversation already
      // is, so a reply to a Chat cannot land in the shareable one (ADR-0019).
      const comment = await appendComment(repo, {
        conversationId: input.conversation,
        body: input.body,
        ...(await actingAs(input)),
      });
      return commentView(await view(input.conversation), comment.id);
    },

    async react(input: ReactInput): Promise<ReactionResult> {
      const on = await setReaction(repo, {
        conversationId: input.conversation,
        commentId: input.comment,
        emoji: input.emoji,
        ...(await actingAs(input)),
        // An agent that reacts twice means "make sure this is reacted", so the
        // verb states the outcome it wants rather than toggling.
        on: !input.remove,
      });
      return { conversation: input.conversation, comment: input.comment, emoji: input.emoji, on };
    },

    resolve: (input) => setResolvedState(input, true),
    reopen: (input) => setResolvedState(input, false),

    async editComment(input: EditCommentInput): Promise<CommentView> {
      const comment = await editComment(repo, {
        conversationId: input.conversation,
        commentId: input.comment,
        body: input.body,
        ...(await actingAs(input)),
      });
      return commentView(await view(input.conversation), comment.id);
    },

    async deleteComment(input: CommentRefInput): Promise<DeletedResult> {
      await deleteComment(repo, {
        conversationId: input.conversation,
        commentId: input.comment,
        ...(await actingAs(input)),
        // Whoever runs this is the Owner: it is their filesystem. Moderation is
        // always available here, unlike the served path where a Tunnel guest
        // reaches the same verbs.
        isOwner: true,
      });
      return { conversation: input.conversation, comment: input.comment, deleted: true };
    },

    async deleteConversation(input: ConversationRefInput): Promise<DeletedResult> {
      await deleteConversation(repo, {
        conversationId: input.conversation,
        ...(await actingAs(input)),
        isOwner: true,
      });
      return { conversation: input.conversation, comment: null, deleted: true };
    },

    async promote(input: PromoteInput): Promise<ConversationView> {
      // No agent name, deliberately. Promotion is the human's call (CONTEXT
      // "Promotion"): an agent may write in a Chat all it likes, but deciding
      // what the rest of the team reads is not its decision to make.
      const thread = await promoteConversation(repo, {
        conversationId: input.conversation,
        commentIds: input.comments,
        ...(input.summary ? { summary: input.summary } : {}),
        author: await resolveAuthor(rootDir),
      });
      return toConversationView(thread);
    },
  };
}

// The remote target: the same verb set, over HTTP (ADR-0020).
//
// The abstraction is the use case, not the wire. A surface holding a
// `ConversationApi` cannot tell whether it is writing YAML in the tree it is
// standing in or POSTing to a hosted Site — which is what lets one CLI command
// and one MCP tool serve both.
//
// Where the two genuinely differ, they differ loudly. A hosted Site has
// Viewers, tokens and Versions that a directory of files does not, so a verb
// the server needs an identity for says so in a sentence rather than failing
// somewhere inside a 403 ("Same API" is true for the Conversation surface and
// false elsewhere — ADR-0020).

import type {
  Anchor,
  CommentInput,
  CommentRefInput,
  CommentView,
  ConversationApi,
  ConversationRefInput,
  ConversationView,
  DeletedResult,
  EditCommentInput,
  ListInput,
  PromoteInput,
  ReactInput,
  ReactionResult,
  ReplyInput,
  ResolvedResult,
} from "@scholia/core";
import type { ScholiaClient, SiteCommentDTO } from "./client.js";

export interface RemoteApiOptions {
  /**
   * The Viewer acting, for the verbs the server checks authorship or Chat
   * ownership on (`edit_comment`, `promote`). Not needed for anything a token
   * alone authorizes.
   */
  viewerId?: string;
}

/** What the hosted API calls a Comment, in the shape the agent surfaces use. */
interface HostedComment {
  id?: unknown;
  commentId?: unknown;
  author?: unknown;
  body?: unknown;
  createdAt?: unknown;
  editedAt?: unknown;
  deleted?: unknown;
  reactions?: unknown;
}

interface HostedConversation {
  id?: unknown;
  pagePath?: unknown;
  anchor?: unknown;
  resolved?: unknown;
  resolvedBy?: unknown;
  visibility?: unknown;
  comments?: unknown;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * The hosted `Identity` ({ name, kind, tier }) as an author.
 *
 * `kind` is the same distinction the Sidecar writes as `authorKind`: the local
 * path has an agent declare its name, the hosted path resolves it from the
 * token, and both come out as the one bit an agent reader cares about.
 */
function author(value: unknown): { author: string; author_kind: "human" | "agent" } {
  if (typeof value === "string") return { author: value, author_kind: "human" };
  const identity = (value ?? {}) as { name?: unknown; kind?: unknown };
  return {
    author: text(identity.name, "unknown"),
    author_kind: identity.kind === "agent" ? "agent" : "human",
  };
}

function reactions(value: unknown): CommentView["reactions"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const group = (entry ?? {}) as { emoji?: unknown; count?: unknown; authors?: unknown };
    if (typeof group.emoji !== "string") return [];
    const authors = Array.isArray(group.authors) ? group.authors.map(String) : undefined;
    return [
      {
        emoji: group.emoji,
        count: typeof group.count === "number" ? group.count : (authors?.length ?? 0),
        ...(authors ? { authors } : {}),
      },
    ];
  });
}

function commentView(value: HostedComment): CommentView {
  return {
    id: text(value.id ?? value.commentId),
    ...author(value.author),
    timestamp: text(value.createdAt),
    body: text(value.body),
    edited_at: typeof value.editedAt === "string" ? value.editedAt : null,
    deleted: value.deleted === true,
    reactions: reactions(value.reactions),
  };
}

function conversationView(value: HostedConversation): ConversationView {
  const comments = Array.isArray(value.comments)
    ? value.comments.map((comment) => commentView((comment ?? {}) as HostedComment))
    : [];
  const first = comments[0];
  return {
    id: text(value.id),
    page: typeof value.pagePath === "string" ? value.pagePath : null,
    visibility: value.visibility === "private" ? "private" : "public",
    author: first?.author ?? "unknown",
    timestamp: first?.timestamp ?? "",
    anchor: (value.anchor as Anchor | null) ?? null,
    resolved: value.resolved === true,
    resolved_by: typeof value.resolvedBy === "string" ? value.resolvedBy : null,
    comment_count: comments.length,
    comments,
  };
}

/**
 * The site-wide flat Comment feed, gathered back into Conversations.
 *
 * The hosted list endpoint answers in Comments because that is the shape the
 * `--since` polling feed wants; the verb answers in Conversations because that
 * is the aggregate every other verb names (ADR-0020). Grouping here is what
 * keeps that difference off both surfaces.
 */
function groupComments(comments: SiteCommentDTO[]): ConversationView[] {
  const byConversation = new Map<string, ConversationView>();

  for (const dto of comments) {
    let conversation = byConversation.get(dto.conversationId);
    const comment = commentView({
      id: dto.commentId,
      author: dto.author,
      body: dto.body,
      createdAt: dto.createdAt,
      editedAt: dto.editedAt,
      reactions: dto.reactions,
    });

    if (!conversation) {
      conversation = {
        id: dto.conversationId,
        page: dto.pagePath,
        visibility: "public",
        author: comment.author,
        timestamp: comment.timestamp,
        anchor: dto.anchor as Anchor | null,
        resolved: dto.resolved,
        resolved_by: null,
        comment_count: 0,
        comments: [],
      };
      byConversation.set(dto.conversationId, conversation);
    }

    conversation.comments.push(comment);
    conversation.comment_count = conversation.comments.length;
  }

  return [...byConversation.values()];
}

/** A verb this server needs a Viewer for, called without one. */
function requireViewer(viewerId: string | undefined, verb: string): string {
  if (viewerId) return viewerId;
  throw new Error(
    `${verb} against a hosted Site needs a viewer identity — pass --viewer <id> or set ` +
      `SCHOLIA_VIEWER. Locally it is not needed: the tree is yours.`,
  );
}

export function createRemoteApi(
  client: ScholiaClient,
  options: RemoteApiOptions = {},
): ConversationApi {
  const { viewerId } = options;

  /** The agent name a surface declared, as the hosted API's attribution label. */
  const label = (input: { agent?: string }): { label?: string } =>
    input.agent ? { label: input.agent } : {};

  const anchorFrom = (input: CommentInput): { anchor?: Anchor } =>
    input.anchor
      ? {
          anchor: {
            textQuote: {
              exact: input.anchor,
              ...(input.prefix ? { prefix: input.prefix } : {}),
              ...(input.suffix ? { suffix: input.suffix } : {}),
            },
          },
        }
      : {};

  async function created(promise: Promise<unknown>): Promise<ConversationView> {
    return conversationView((await promise) as HostedConversation);
  }

  return {
    async listConversations(input: ListInput): Promise<ConversationView[]> {
      const { comments } = await client.listComments({
        ...(input.unresolved ? { unresolved: true } : {}),
        ...(input.since === undefined ? {} : { since: input.since }),
        ...(input.mentions === undefined ? {} : { mentions: input.mentions }),
      });
      const conversations = groupComments(comments);
      // The hosted feed is site-wide and has no path filter; the DTO carries
      // the Page, so the narrowing happens here rather than costing a verb.
      return input.page === undefined
        ? conversations
        : conversations.filter((conversation) => conversation.page === input.page);
    },

    async listChats(input: ListInput): Promise<ConversationView[]> {
      const { chats } = await client.listChats({
        ...(input.since === undefined ? {} : { since: input.since }),
        ...(input.page === undefined ? {} : { path: input.page }),
      });
      const conversations = chats.map((chat) =>
        conversationView((chat ?? {}) as HostedConversation),
      );
      return input.unresolved
        ? conversations.filter((conversation) => !conversation.resolved)
        : conversations;
    },

    comment(input: CommentInput): Promise<ConversationView> {
      const options = {
        body: input.body,
        ...(input.page ? { pagePath: input.page } : {}),
        ...anchorFrom(input),
        ...label(input),
      };
      return created(input.chat ? client.createChat(options) : client.createThread(options));
    },

    async reply(input: ReplyInput): Promise<CommentView> {
      const comment = await client.reply({
        conversationId: input.conversation,
        body: input.body,
        ...label(input),
      });
      return commentView(comment ?? {});
    },

    async react(input: ReactInput): Promise<ReactionResult> {
      // The hosted endpoint toggles, so "make sure this is off" is not a verb
      // it has. Saying so beats silently turning a Reaction back on.
      if (input.remove) {
        throw new Error(
          "react --remove is not supported against a hosted Site — the hosted Reaction " +
            "endpoint toggles, so reacting again with the same emoji takes it back.",
        );
      }
      await client.react({ commentId: input.comment, emoji: input.emoji, ...label(input) });
      return {
        conversation: input.conversation,
        comment: input.comment,
        emoji: input.emoji,
        on: true,
      };
    },

    async resolve(input: ConversationRefInput): Promise<ResolvedResult> {
      await client.resolve({ conversationId: input.conversation, ...label(input) });
      return { conversation: input.conversation, resolved: true };
    },

    async reopen(input: ConversationRefInput): Promise<ResolvedResult> {
      await client.reopen({ conversationId: input.conversation, ...label(input) });
      return { conversation: input.conversation, resolved: false };
    },

    async editComment(input: EditCommentInput): Promise<CommentView> {
      const comment = await client.editComment({
        commentId: input.comment,
        body: input.body,
        viewerId: requireViewer(viewerId, "edit_comment"),
      });
      return commentView(comment ?? {});
    },

    async deleteComment(input: CommentRefInput): Promise<DeletedResult> {
      await client.deleteComment({ commentId: input.comment });
      return { conversation: input.conversation, comment: input.comment, deleted: true };
    },

    async deleteConversation(input: ConversationRefInput): Promise<DeletedResult> {
      await client.deleteConversation(input.conversation);
      return { conversation: input.conversation, comment: null, deleted: true };
    },

    promote(input: PromoteInput): Promise<ConversationView> {
      return created(
        client.promote({
          conversationId: input.conversation,
          commentIds: input.comments,
          ...(input.summary ? { summary: input.summary } : {}),
          viewerId: requireViewer(viewerId, "promote"),
        }),
      );
    },
  };
}

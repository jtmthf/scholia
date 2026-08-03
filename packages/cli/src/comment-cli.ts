// CLI commands for local Conversations (ADR-0018, ADR-0019, ADR-0032).
// `scholia comment` — create a Conversation with its first Comment on a Page.
// `scholia comments` — list Conversations for a Page.
// `scholia resolve` / `reopen` / `react` / `edit-comment` / `delete-comment` /
// `delete-conversation` — the rest of the verb set.
// These are Local Preview commands, not hosted — no server, no token, no network.
//
// This is how an agent reaches these verbs, at parity with the browser (ADR-0021).
// Both surfaces call the same `core` use cases against the same Sidecar, so an
// agent's Reaction and a reader's are the same event in the same file.
//
// Whoever runs the CLI is the Owner: it is their filesystem, and the Sidecar is
// a directory they could delete outright. So moderation is always available
// here, unlike the served path, where a Tunnel guest reaches the same routes.

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
  type Anchor,
  type AuthorKind,
} from "@scholia/core";
import { SidecarStore, resolveAuthor } from "@scholia/sidecar";

/**
 * What every write command accepts for "who is doing this".
 *
 * Locally there are no tokens (CONTEXT "Identity"): the human comes from git
 * config, and an agent simply declares its own name. `--agent "Claude Code"` is
 * that declaration — it is how an agent's Comments end up marked as an agent's,
 * and it is spoofable by design, which is the same posture as the rest of the
 * local path applied to files you already own.
 */
export interface ActingAs {
  /** The agent's own name. Omitted when a person is running the command. */
  agent?: string;
}

export interface CommentCreateOptions extends ActingAs {
  page: string;
  body: string;
  anchor?: string;
  prefix?: string;
  suffix?: string;
  root?: string;
  /** Start a private Chat rather than a public Thread (CONTEXT "Chat"). */
  chat?: boolean;
}

export interface ReplyOptions extends ActingAs {
  conversation: string;
  body: string;
  root?: string;
}

export interface PromoteOptions {
  conversation: string;
  /** Which Chat Comments become public. */
  comments: string[];
  summary?: string;
  root?: string;
}

export interface CommentListOptions {
  page: string;
  root?: string;
  json?: boolean;
}

export interface ResolveOptions extends ActingAs {
  conversation: string;
  root?: string;
}

export interface ReactOptions extends ActingAs {
  conversation: string;
  comment: string;
  emoji: string;
  /** Take the reaction back instead of adding it. */
  remove?: boolean;
  root?: string;
}

export interface EditCommentOptions extends ActingAs {
  conversation: string;
  comment: string;
  body: string;
  root?: string;
}

export interface DeleteCommentOptions extends ActingAs {
  conversation: string;
  comment: string;
  root?: string;
}

export interface DeleteConversationOptions extends ActingAs {
  conversation: string;
  root?: string;
}

// sha256 of the Page's Source, the same hash a hosted Version records for it
// (`StoredPage.contentHash`), so one binding spans both paths. Returns an empty
// object — not `{ contentHash: undefined }` — when the path names nothing
// readable, so the header simply omits the field.
async function pageContentHash(
  rootDir: string,
  pagePath: string,
): Promise<{ contentHash?: string }> {
  const fsPath = resolveWithinRoot(rootDir, pagePath);
  if (!fsPath) return {};
  try {
    return { contentHash: hashBytes(await readFile(fsPath)) };
  } catch {
    return {};
  }
}

/**
 * Who is acting, and whether they are a person.
 *
 * `--agent` names the agent and marks what it writes as an agent's; without it
 * the author is whoever git says is at this machine. There is nothing to verify
 * against — see `ActingAs`.
 */
async function actingAs(
  rootDir: string,
  options: ActingAs,
): Promise<{ author: string; authorKind?: AuthorKind }> {
  const agent = options.agent?.trim();
  if (agent) return { author: agent, authorKind: "agent" };
  return { author: await resolveAuthor(rootDir) };
}

export async function commentCreate(options: CommentCreateOptions): Promise<void> {
  const rootDir = resolve(options.root ?? ".");
  const repo = new SidecarStore(rootDir);
  const acting = await actingAs(rootDir, options);

  // Build Anchor from CLI flags. The --anchor flag is the exact quote text;
  // --prefix and --suffix provide context for uniqueness. If --anchor is not
  // provided, the comment is page-level (no text anchor).
  let anchor: Anchor | null = null;
  if (options.anchor) {
    anchor = {
      textQuote: {
        exact: options.anchor,
        ...(options.prefix ? { prefix: options.prefix } : {}),
        ...(options.suffix ? { suffix: options.suffix } : {}),
      },
    };
  }

  const conversation = await createConversation(repo, {
    pagePath: options.page,
    body: options.body,
    anchor,
    ...acting,
    // Which directory the Sidecar files it under, and the whole of what makes it
    // private (ADR-0019).
    visibility: options.chat ? "private" : "public",
    // The binding and its context (CONTEXT "Comment", ADR-0018). Both are
    // best-effort here: `--page` is a path, and it need not name a file that
    // exists on this machine or a directory that is a git repository.
    ...(await pageContentHash(rootDir, options.page)),
    provenance: await getProvenance(rootDir),
  });

  const kind = conversation.visibility === "private" ? "Chat" : "Conversation";
  console.log(`Created ${kind} ${conversation.header.id}`);
  console.log(`  Page:   ${conversation.header.page}`);
  console.log(`  Author: ${conversation.header.author}`);
  if (anchor) console.log(`  Anchor: "${anchor.textQuote.exact}"`);
  console.log(`  Body:   ${conversation.comments[0]!.body}`);
  if (conversation.visibility === "private") {
    console.log(`  Private — in .scholia/chats/, which git is told never to track.`);
  }
}

export async function commentReply(options: ReplyOptions): Promise<void> {
  const rootDir = resolve(options.root ?? ".");
  const repo = new SidecarStore(rootDir);

  // The one verb an agent joining a Chat needs. It names no directory: the event
  // goes wherever the Conversation already is, so a reply to a Chat cannot land
  // in the shareable directory (ADR-0019).
  const comment = await appendComment(repo, {
    conversationId: options.conversation,
    body: options.body,
    ...(await actingAs(rootDir, options)),
  });

  console.log(`Replied to Conversation ${options.conversation}`);
  console.log(`  Comment: ${comment.id}`);
  console.log(`  Author:  ${comment.author}${comment.authorKind === "agent" ? " (agent)" : ""}`);
}

export async function conversationPromote(options: PromoteOptions): Promise<void> {
  const rootDir = resolve(options.root ?? ".");
  const repo = new SidecarStore(rootDir);

  // No `--agent` here, deliberately. Promotion is the human's call (CONTEXT
  // "Promotion"): an agent may write in a Chat all it likes, but deciding what
  // the rest of the team gets to read is not its decision to make.
  const thread = await promoteConversation(repo, {
    conversationId: options.conversation,
    commentIds: options.comments,
    ...(options.summary ? { summary: options.summary } : {}),
    author: await resolveAuthor(rootDir),
  });

  console.log(`Promoted to Thread ${thread.header.id}`);
  console.log(`  Page:     ${thread.header.page}`);
  console.log(`  Messages: ${thread.comments.length}`);
  console.log(`  The Chat ${options.conversation} is untouched and still private.`);
}

export async function commentList(options: CommentListOptions): Promise<void> {
  const rootDir = resolve(options.root ?? ".");
  const repo = new SidecarStore(rootDir);

  const conversations = await listConversations(repo, options.page);

  if (options.json) {
    // The folded state, not the raw stream: an agent asking what a Page says
    // wants what it currently says. It also needs both ids to act — every other
    // command names a Conversation and a Comment.
    const output = conversations.map((c) => ({
      id: c.header.id,
      page: c.header.page,
      // Which directory it came out of. An agent asked to work in a Chat needs
      // to know which Conversations are private before it says anything.
      visibility: c.visibility,
      author: c.header.author,
      timestamp: c.header.timestamp,
      anchor: c.header.anchor,
      resolved: c.resolved,
      resolved_by: c.resolvedBy,
      comment_count: c.comments.length,
      comments: c.comments.map((cm) => ({
        id: cm.id,
        author: cm.author,
        author_kind: cm.authorKind,
        timestamp: cm.timestamp,
        body: cm.body,
        edited_at: cm.editedAt,
        deleted: cm.deleted,
        reactions: cm.reactions,
      })),
    }));
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  if (conversations.length === 0) {
    console.log(`No Conversations found for page: ${options.page}`);
    return;
  }

  console.log(`Conversations on ${options.page} (${conversations.length}):\n`);
  for (const c of conversations) {
    // A lock in front of the id, so a private Conversation cannot be mistaken
    // for one the team can see — the distinction this whole list turns on.
    const lock = c.visibility === "private" ? "🔒 " : "";
    console.log(`  ${lock}${c.header.id}${c.resolved ? `  [resolved by ${c.resolvedBy}]` : ""}`);
    console.log(`    Author: ${c.header.author}  |  ${c.header.timestamp}`);
    if (c.header.anchor) {
      console.log(`    Anchor: "${c.header.anchor.textQuote.exact}"`);
    }
    for (const cm of c.comments) {
      if (cm.deleted) {
        console.log(`    [${cm.author}] (deleted)`);
        continue;
      }
      // Indent multi-line bodies for readability.
      const bodyLines = cm.body.split("\n");
      const first = bodyLines[0] ?? "";
      const badge = cm.authorKind === "agent" ? " (agent)" : "";
      console.log(`    [${cm.author}${badge}] ${first}${cm.editedAt ? "  (edited)" : ""}`);
      for (let i = 1; i < bodyLines.length; i++) {
        console.log(`               ${bodyLines[i]}`);
      }
      if (cm.reactions.length > 0) {
        const tally = cm.reactions.map((r) => `${r.emoji} ${r.authors.length}`).join("  ");
        console.log(`               ${tally}`);
      }
    }
    console.log();
  }
}

// ---------------------------------------------------------------------------
// The rest of the verb set. Each one is the same three steps — open the Sidecar
// in the served root, resolve who is acting, call the `core` use case — so the
// setup lives in one place and each command is only what it actually decides.
// ---------------------------------------------------------------------------

async function openSidecar(options: { root?: string } & ActingAs) {
  const rootDir = resolve(options.root ?? ".");
  return { repo: new SidecarStore(rootDir), acting: await actingAs(rootDir, options) };
}

export async function conversationResolve(options: ResolveOptions, resolved: boolean) {
  const { repo, acting } = await openSidecar(options);
  await setResolved(repo, { conversationId: options.conversation, resolved, ...acting });
  console.log(`${resolved ? "Resolved" : "Reopened"} Conversation ${options.conversation}`);
}

export async function commentReact(options: ReactOptions): Promise<void> {
  const { repo, acting } = await openSidecar(options);
  const on = await setReaction(repo, {
    conversationId: options.conversation,
    commentId: options.comment,
    emoji: options.emoji,
    ...acting,
    // An agent that ran `react` twice meaning "make sure this is reacted" would
    // otherwise have taken it back, so the CLI states the outcome it wants
    // rather than toggling.
    on: !options.remove,
  });
  console.log(`${on ? "Reacted" : "Un-reacted"} ${options.emoji} on Comment ${options.comment}`);
}

export async function commentEdit(options: EditCommentOptions): Promise<void> {
  const { repo, acting } = await openSidecar(options);
  await editComment(repo, {
    conversationId: options.conversation,
    commentId: options.comment,
    body: options.body,
    ...acting,
  });
  console.log(`Edited Comment ${options.comment}`);
}

export async function commentDelete(options: DeleteCommentOptions): Promise<void> {
  const { repo, acting } = await openSidecar(options);
  await deleteComment(repo, {
    conversationId: options.conversation,
    commentId: options.comment,
    ...acting,
    isOwner: true,
  });
  console.log(`Deleted Comment ${options.comment} — a tombstone, the stream is intact`);
}

export async function conversationDelete(options: DeleteConversationOptions): Promise<void> {
  const { repo, acting } = await openSidecar(options);
  await deleteConversation(repo, {
    conversationId: options.conversation,
    ...acting,
    isOwner: true,
  });
  console.log(
    `Deleted Conversation ${options.conversation} — a tombstone; the file is still in .scholia/`,
  );
}

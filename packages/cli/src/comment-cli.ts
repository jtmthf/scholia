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
  createConversation,
  deleteComment,
  deleteConversation,
  editComment,
  getProvenance,
  hashBytes,
  listConversations,
  resolveWithinRoot,
  setReaction,
  setResolved,
  type Anchor,
} from "@scholia/core";
import { SidecarStore, resolveAuthor } from "@scholia/sidecar";

export interface CommentCreateOptions {
  page: string;
  body: string;
  anchor?: string;
  prefix?: string;
  suffix?: string;
  root?: string;
}

export interface CommentListOptions {
  page: string;
  root?: string;
  json?: boolean;
}

export interface ResolveOptions {
  conversation: string;
  root?: string;
}

export interface ReactOptions {
  conversation: string;
  comment: string;
  emoji: string;
  /** Take the reaction back instead of adding it. */
  remove?: boolean;
  root?: string;
}

export interface EditCommentOptions {
  conversation: string;
  comment: string;
  body: string;
  root?: string;
}

export interface DeleteCommentOptions {
  conversation: string;
  comment: string;
  root?: string;
}

export interface DeleteConversationOptions {
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

export async function commentCreate(options: CommentCreateOptions): Promise<void> {
  const rootDir = resolve(options.root ?? ".");
  const repo = new SidecarStore(rootDir);
  const author = await resolveAuthor(rootDir);

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
    author,
    // The binding and its context (CONTEXT "Comment", ADR-0018). Both are
    // best-effort here: `--page` is a path, and it need not name a file that
    // exists on this machine or a directory that is a git repository.
    ...(await pageContentHash(rootDir, options.page)),
    provenance: await getProvenance(rootDir),
  });

  console.log(`Created Conversation ${conversation.header.id}`);
  console.log(`  Page:   ${conversation.header.page}`);
  console.log(`  Author: ${conversation.header.author}`);
  if (anchor) console.log(`  Anchor: "${anchor.textQuote.exact}"`);
  console.log(`  Body:   ${conversation.comments[0]!.body}`);
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
      author: c.header.author,
      timestamp: c.header.timestamp,
      anchor: c.header.anchor,
      resolved: c.resolved,
      resolved_by: c.resolvedBy,
      comment_count: c.comments.length,
      comments: c.comments.map((cm) => ({
        id: cm.id,
        author: cm.author,
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
    console.log(`  ${c.header.id}${c.resolved ? `  [resolved by ${c.resolvedBy}]` : ""}`);
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
      console.log(`    [${cm.author}] ${first}${cm.editedAt ? "  (edited)" : ""}`);
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

async function openSidecar(root: string | undefined) {
  const rootDir = resolve(root ?? ".");
  return { repo: new SidecarStore(rootDir), author: await resolveAuthor(rootDir) };
}

export async function conversationResolve(options: ResolveOptions, resolved: boolean) {
  const { repo, author } = await openSidecar(options.root);
  await setResolved(repo, { conversationId: options.conversation, resolved, author });
  console.log(`${resolved ? "Resolved" : "Reopened"} Conversation ${options.conversation}`);
}

export async function commentReact(options: ReactOptions): Promise<void> {
  const { repo, author } = await openSidecar(options.root);
  const on = await setReaction(repo, {
    conversationId: options.conversation,
    commentId: options.comment,
    emoji: options.emoji,
    author,
    // An agent that ran `react` twice meaning "make sure this is reacted" would
    // otherwise have taken it back, so the CLI states the outcome it wants
    // rather than toggling.
    on: !options.remove,
  });
  console.log(`${on ? "Reacted" : "Un-reacted"} ${options.emoji} on Comment ${options.comment}`);
}

export async function commentEdit(options: EditCommentOptions): Promise<void> {
  const { repo, author } = await openSidecar(options.root);
  await editComment(repo, {
    conversationId: options.conversation,
    commentId: options.comment,
    body: options.body,
    author,
  });
  console.log(`Edited Comment ${options.comment}`);
}

export async function commentDelete(options: DeleteCommentOptions): Promise<void> {
  const { repo, author } = await openSidecar(options.root);
  await deleteComment(repo, {
    conversationId: options.conversation,
    commentId: options.comment,
    author,
    isOwner: true,
  });
  console.log(`Deleted Comment ${options.comment} — a tombstone, the stream is intact`);
}

export async function conversationDelete(options: DeleteConversationOptions): Promise<void> {
  const { repo, author } = await openSidecar(options.root);
  await deleteConversation(repo, {
    conversationId: options.conversation,
    author,
    isOwner: true,
  });
  console.log(
    `Deleted Conversation ${options.conversation} — a tombstone; the file is still in .scholia/`,
  );
}

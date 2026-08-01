// CLI commands for local Conversations (ADR-0018, ADR-0019).
// `scholia comment` — create a Conversation with its first Comment on a Page.
// `scholia comments` — list Conversations for a Page.
// These are Local Preview commands, not hosted — no server, no token, no network.

import { resolve } from "node:path";
import {
  createConversation,
  listConversations,
  type Anchor,
} from "@scholia/core";
import { SidecarStore } from "./sidecar.js";
import { resolveAuthor } from "./author.js";

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
    const output = conversations.map((c) => ({
      id: c.header.id,
      page: c.header.page,
      author: c.header.author,
      timestamp: c.header.timestamp,
      anchor: c.header.anchor,
      comment_count: c.comments.length,
      comments: c.comments.map((cm) => ({
        id: cm.id,
        author: cm.author,
        timestamp: cm.timestamp,
        body: cm.body,
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
    console.log(`  ${c.header.id}`);
    console.log(`    Author: ${c.header.author}  |  ${c.header.timestamp}`);
    if (c.header.anchor) {
      console.log(`    Anchor: "${c.header.anchor.textQuote.exact}"`);
    }
    for (const cm of c.comments) {
      // Indent multi-line bodies for readability.
      const bodyLines = cm.body.split("\n");
      const first = bodyLines[0] ?? "";
      console.log(`    [${cm.author}] ${first}`);
      for (let i = 1; i < bodyLines.length; i++) {
        console.log(`               ${bodyLines[i]}`);
      }
    }
    console.log();
  }
}

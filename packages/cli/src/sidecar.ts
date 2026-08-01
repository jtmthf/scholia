// Sidecar adapter — the filesystem-backed ConversationRepository (ADR-0018, ADR-0019).
// Reads and writes the multi-document YAML stream format:
//   Document 0: immutable header (id, page, anchor, author, timestamp)
//   Documents 1..n: append-only events (comment, etc.)
// Current state is a fold over the stream with dedup by event id.
//
// Stored at `<rootDir>/.scholia/conversations/<uuid>.yaml`, self-ignored by
// a `.gitignore` in the `.scholia/` directory.

import { readFile, writeFile, mkdir, readdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { parseAllDocuments, stringify } from "yaml";
import type {
  ConversationRepository,
  CreateConversationInput,
  Conversation,
  ConversationHeader,
  Comment,
} from "@scholia/core";
import type { Anchor } from "@scholia/core";

const SIDECAR_DIR = ".scholia";
const CONVERSATIONS_DIR = "conversations";

/** Shape of the header document as read from YAML (doc 0). */
interface YamlHeader {
  id: string;
  page: string;
  anchor: unknown;
  author: string;
  timestamp: string;
}

/** Shape of a comment event document as read from YAML (docs 1..n). */
interface YamlCommentEvent {
  id: string;
  type: string;
  timestamp: string;
  author: string;
  body: string;
}

export class SidecarStore implements ConversationRepository {
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  private get convDir(): string {
    return join(this.rootDir, SIDECAR_DIR, CONVERSATIONS_DIR);
  }

  /** Ensure the Sidecar directory exists and is self-ignored by git. */
  private async ensureDir(): Promise<void> {
    await mkdir(this.convDir, { recursive: true });
    // Self-ignoring .gitignore: nothing in .scholia/ is tracked by default.
    // Committing it is an explicit per-repo opt-in (ADR-0018).
    const gitignorePath = join(this.rootDir, SIDECAR_DIR, ".gitignore");
    try {
      await writeFile(gitignorePath, "*\n", { flag: "wx" });
    } catch {
      // Already exists — fine.
    }
  }

  async createConversation(input: CreateConversationInput): Promise<Conversation> {
    await this.ensureDir();

    const { header, firstComment } = input;

    // Build the multi-document YAML stream: doc 0 = header, doc 1 = first event.
    // Each document is stringified individually and joined with `---\n`, which is
    // the YAML multi-document separator that parseAllDocuments expects.
    // The yaml library automatically uses block scalars (`|`) for multi-line
    // bodies, so no body content — including `---`, YAML syntax, or markdown —
    // can escape its field or corrupt the document structure.
    const docs = [
      stringify({
        id: header.id,
        page: header.page,
        anchor: header.anchor,
        author: header.author,
        timestamp: header.timestamp,
      }),
      stringify({
        id: firstComment.id,
        type: firstComment.type,
        timestamp: firstComment.timestamp,
        author: firstComment.author,
        body: firstComment.body,
      }),
    ];

    const yamlStream = docs.join("---\n");

    // Atomic write: write to a temp file, then rename onto the final path.
    // rename(2) is atomic on the same filesystem, so a reader never sees a
    // partially-written file.
    const filePath = join(this.convDir, `${header.id}.yaml`);
    const tmpPath = filePath + ".tmp." + Date.now().toString(36);

    await writeFile(tmpPath, yamlStream, { flag: "wx" });
    try {
      await rename(tmpPath, filePath);
    } catch {
      // Clean up temp file on failure.
      await unlink(tmpPath).catch(() => {});
      throw new Error(
        `failed to write Conversation ${header.id} — a file with that id already exists`,
      );
    }

    return {
      header,
      comments: [
        {
          id: firstComment.id,
          conversationId: header.id,
          author: firstComment.author,
          body: firstComment.body,
          timestamp: firstComment.timestamp,
        },
      ],
    };
  }

  async listConversations(pagePath: string): Promise<Conversation[]> {
    await this.ensureDir();

    let entries: string[];
    try {
      entries = await readdir(this.convDir);
    } catch {
      return [];
    }

    const conversations: Conversation[] = [];

    for (const entry of entries) {
      if (!entry.endsWith(".yaml")) continue;

      const filePath = join(this.convDir, entry);
      const raw = await readFile(filePath, "utf8");
      const docs = parseAllDocuments(raw);

      if (docs.length < 2) continue;

      const headerDoc = docs[0]!.toJSON() as YamlHeader | null;
      if (!headerDoc) continue;

      // Filter by page early — skip conversations not anchored to this Page.
      if (headerDoc.page !== pagePath) continue;

      const header: ConversationHeader = {
        id: headerDoc.id,
        page: headerDoc.page,
        anchor: headerDoc.anchor as Anchor | null,
        author: headerDoc.author,
        timestamp: headerDoc.timestamp,
      };

      // Fold events into Comments, deduping by event id (ADR-0019).
      // Union merge can produce duplicate events from cherry-picks/rebase;
      // dedup makes that a no-op rather than a double-post.
      const comments = new Map<string, Comment>();
      for (let i = 1; i < docs.length; i++) {
        const doc = docs[i]!.toJSON() as YamlCommentEvent | null;
        if (!doc || doc.type !== "comment") continue;
        if (comments.has(doc.id)) continue;

        comments.set(doc.id, {
          id: doc.id,
          conversationId: header.id,
          author: doc.author,
          body: doc.body,
          timestamp: doc.timestamp,
        });
      }

      conversations.push({
        header,
        comments: [...comments.values()],
      });
    }

    return conversations;
  }
}

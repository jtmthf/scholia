// Sidecar adapter — the filesystem-backed ConversationRepository (ADR-0018, ADR-0019).
// Reads and writes the multi-document YAML stream format:
//   Document 0: immutable header (id, page, anchor, contentHash, provenance,
//               author, timestamp)
//   Documents 1..n: append-only events (comment, etc.)
// Current state is a fold over the stream with dedup by event id.
//
// Nothing here ever rewrites a document. Creation writes the whole stream once;
// every later Comment is an O_APPEND of one more document onto the end.
//
// Stored at `<rootDir>/.scholia/conversations/<uuid>.yaml`, self-ignored by
// a `.gitignore` in the `.scholia/` directory.

import { appendFile, readFile, writeFile, mkdir, readdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { parseAllDocuments, stringify } from "yaml";
import type {
  ConversationRepository,
  CreateConversationInput,
  CommentEvent,
  Conversation,
  ConversationHeader,
  Comment,
  Provenance,
} from "@scholia/core";
import type { Anchor } from "@scholia/core";

export const SIDECAR_DIR = ".scholia";
export const CONVERSATIONS_DIR = "conversations";

// The YAML multi-document separator. Every document the store writes is
// stringified on its own and prefixed with this, which is what makes an append a
// byte-level concatenation rather than a re-serialization of the whole stream.
const DOC_SEPARATOR = "---\n";

// A Conversation's id is also its filename, so it has to be constrained before
// it reaches `join`. UUIDv7 (ADR-0019) is the only shape we ever write; anything
// else is either a bug or a caller trying to walk out of the store's directory.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shape of the header document as read from YAML (doc 0). */
interface YamlHeader {
  id: string;
  page: string;
  anchor: unknown;
  contentHash?: string;
  provenance?: Provenance;
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

  private filePathFor(conversationId: string): string {
    if (!UUID_RE.test(conversationId)) {
      throw new Error(`not a Conversation id: ${conversationId}`);
    }
    return join(this.convDir, `${conversationId}.yaml`);
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
        // Omitted rather than written as `null` when absent, so a header carries
        // no field it has nothing to say about.
        ...(header.contentHash ? { contentHash: header.contentHash } : {}),
        ...(header.provenance ? { provenance: header.provenance } : {}),
        author: header.author,
        timestamp: header.timestamp,
      }),
      stringifyEvent(firstComment),
    ];

    const yamlStream = docs.join(DOC_SEPARATOR);

    // Atomic write: write to a temp file, then rename onto the final path.
    // rename(2) is atomic on the same filesystem, so a reader never sees a
    // partially-written file.
    const filePath = this.filePathFor(header.id);
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

  async appendComment(conversationId: string, event: CommentEvent): Promise<void> {
    const filePath = this.filePathFor(conversationId);

    // The aggregate has to exist before it can be appended to — an append onto a
    // missing file would create a stream with no header, which nothing can fold.
    try {
      await readFile(filePath, "utf8");
    } catch {
      throw new Error(`no Conversation ${conversationId} in the Sidecar`);
    }

    // O_APPEND, not read-modify-write. Two writers (a preview server and an
    // agent driving the CLI in-process, ADR-0020) can be appending to the same
    // Conversation, and every document the store writes ends in a newline, so
    // concurrent appends interleave whole documents rather than corrupting one.
    await appendFile(filePath, DOC_SEPARATOR + stringifyEvent(event), { flag: "a" });
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
        ...(headerDoc.contentHash ? { contentHash: headerDoc.contentHash } : {}),
        ...(headerDoc.provenance ? { provenance: headerDoc.provenance } : {}),
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

      // Union merge keeps both sides' lines, so file position is not a reliable
      // order — ADR-0019 says ordering is recovered from timestamps. Ids are
      // UUIDv7 and therefore time-sortable, which breaks ties from the same
      // millisecond deterministically.
      const ordered = [...comments.values()].sort(
        (a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id),
      );

      conversations.push({ header, comments: ordered });
    }

    return conversations;
  }
}

// One event, one YAML document. The yaml library picks a `|` block scalar for
// any multi-line body on its own, so no body — including one containing `---`,
// YAML syntax or markdown — can escape its field (ADR-0019). Kept in one place
// because creation and reply must serialize identically: an appended document
// that differed in shape would fold differently from the one written at
// creation.
function stringifyEvent(event: CommentEvent): string {
  return stringify({
    id: event.id,
    type: event.type,
    timestamp: event.timestamp,
    author: event.author,
    body: event.body,
  });
}

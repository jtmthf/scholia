// Sidecar adapter — the filesystem-backed ConversationRepository (ADR-0018, ADR-0019).
// Reads and writes the multi-document YAML stream format:
//   Document 0: immutable header (id, page, anchor, contentHash, provenance,
//               author, timestamp)
//   Documents 1..n: append-only events (comment, edited, deleted, reacted,
//               unreacted, resolved, reopened — ADR-0032)
// Current state is a fold over the stream, which lives in `@scholia/core`: this
// file's job is bytes on disk, not what an event means.
//
// Nothing here ever rewrites a document. Creation writes the whole stream once;
// every later event — a reply, an edit, a tombstone, a reaction — is an O_APPEND
// of one more document onto the end.
//
// Stored at `<rootDir>/.scholia/conversations/<uuid>.yaml`, self-ignored by
// a `.gitignore` in the `.scholia/` directory.

import { appendFile, readFile, writeFile, mkdir, readdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { parseAllDocuments, stringify } from "yaml";
import {
  foldConversation,
  type ConversationRepository,
  type CreateConversationInput,
  type ConversationEvent,
  type Conversation,
  type ConversationHeader,
  type Provenance,
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

/** Shape of an event document as read from YAML (docs 1..n), before validation. */
interface YamlEvent {
  id?: unknown;
  type?: unknown;
  timestamp?: unknown;
  author?: unknown;
  target?: unknown;
  body?: unknown;
  emoji?: unknown;
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

    return foldConversation(header, [firstComment]);
  }

  async appendEvent(conversationId: string, event: ConversationEvent): Promise<void> {
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

  async getConversation(conversationId: string): Promise<Conversation | null> {
    // Resolved outside the try: an id that is not a UUID is a caller trying to
    // walk out of the store's directory, and must stay loud rather than come
    // back as an ordinary "no such Conversation".
    const filePath = this.filePathFor(conversationId);

    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch {
      return null;
    }
    return parseStream(raw);
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

      const raw = await readFile(join(this.convDir, entry), "utf8");
      const conversation = parseStream(raw);
      // Filter by page — a Conversation is on exactly one Page (CONTEXT "Page").
      if (!conversation || conversation.header.page !== pagePath) continue;

      conversations.push(conversation);
    }

    return conversations;
  }
}

/** One YAML stream — header plus events — folded into a Conversation. */
function parseStream(raw: string): Conversation | null {
  const docs = parseAllDocuments(raw);
  if (docs.length < 2) return null;

  const headerDoc = docs[0]!.toJSON() as YamlHeader | null;
  if (!headerDoc) return null;

  const header: ConversationHeader = {
    id: headerDoc.id,
    page: headerDoc.page,
    anchor: headerDoc.anchor as Anchor | null,
    ...(headerDoc.contentHash ? { contentHash: headerDoc.contentHash } : {}),
    ...(headerDoc.provenance ? { provenance: headerDoc.provenance } : {}),
    author: headerDoc.author,
    timestamp: headerDoc.timestamp,
  };

  const events: ConversationEvent[] = [];
  for (let i = 1; i < docs.length; i++) {
    const event = readEvent(docs[i]!.toJSON() as YamlEvent | null);
    if (event) events.push(event);
  }

  return foldConversation(header, events);
}

/**
 * One parsed YAML document as an event, or null if it is not one.
 *
 * Unrecognised documents are dropped rather than rejected. A Sidecar can be
 * committed and pulled, so a stream may carry an event kind written by a newer
 * Scholia than the one reading it (`reanchored`, say — ADR-0019 names it but
 * nothing writes it yet). Refusing to read the file would make an unknown event
 * worse than a corrupt one.
 */
function readEvent(doc: YamlEvent | null): ConversationEvent | null {
  if (!doc) return null;
  const { id, type, timestamp, author } = doc;
  if (typeof id !== "string" || typeof timestamp !== "string" || typeof author !== "string") {
    return null;
  }

  const base = { id, timestamp, author };
  const target = typeof doc.target === "string" ? doc.target : null;
  const body = typeof doc.body === "string" ? doc.body : null;
  const emoji = typeof doc.emoji === "string" ? doc.emoji : null;

  switch (type) {
    case "comment":
      return body === null ? null : { ...base, type, body };
    case "edited":
      return target === null || body === null ? null : { ...base, type, target, body };
    case "deleted":
      return target === null ? null : { ...base, type, target };
    case "reacted":
    case "unreacted":
      return target === null || emoji === null ? null : { ...base, type, target, emoji };
    case "resolved":
    case "reopened":
      return { ...base, type };
    default:
      return null;
  }
}

// One event, one YAML document. The yaml library picks a `|` block scalar for
// any multi-line body on its own, so no body — including one containing `---`,
// YAML syntax or markdown — can escape its field (ADR-0019). Kept in one place
// because every writer must serialize identically: an appended document that
// differed in shape would fold differently from the one written at creation.
//
// Field order is fixed and the optional fields are omitted rather than written
// as `null`, so an event carries nothing it has no meaning for — these files are
// read by people, in PR diffs.
function stringifyEvent(event: ConversationEvent): string {
  return stringify({
    id: event.id,
    type: event.type,
    timestamp: event.timestamp,
    author: event.author,
    ...("target" in event ? { target: event.target } : {}),
    ...("emoji" in event ? { emoji: event.emoji } : {}),
    ...("body" in event ? { body: event.body } : {}),
  });
}

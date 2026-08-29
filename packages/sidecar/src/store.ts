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
// **Visibility is the directory** (ADR-0019). Threads live in
// `<rootDir>/.scholia/conversations/`, Chats in `<rootDir>/.scholia/chats/`, and
// nothing in the YAML says which is which — a `visibility:` field would be a
// string that a single `git add` blows straight through, and one that could
// disagree with where the file actually is. A Conversation read back is private
// because of the directory it was found in, and for no other reason.
//
// The directories themselves, and the two git-facing files that decide whether
// any of this is tracked, are `layout.ts` — shared with `tracking.ts`, which is
// the only thing that ever changes the answer.

import { appendFile, readFile, writeFile, readdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { parseAllDocuments, stringify } from "yaml";
import {
  foldConversation,
  type AuthorKind,
  type ConversationRepository,
  type CreateConversationInput,
  type ConversationEvent,
  type Conversation,
  type ConversationHeader,
  type Provenance,
  type Visibility,
} from "@scholia/core";
import type { Anchor } from "@scholia/core";
import { CHATS_DIR, CONVERSATIONS_DIR, ensureSidecarLayout, sidecarDir } from "./layout.js";

/** Which directory a Conversation of each visibility lives in. */
const DIR_FOR: Record<Visibility, string> = {
  public: CONVERSATIONS_DIR,
  private: CHATS_DIR,
};

/**
 * The order directories are searched when only an id is known.
 *
 * Ids are UUIDv7 and unique across the Sidecar, so at most one directory can
 * hold a given Conversation and the order is not a tiebreak — it only decides
 * which `stat` happens first.
 */
const ALL_VISIBILITIES: Visibility[] = ["public", "private"];

/**
 * One YAML document, opened and closed by markers carrying its own id.
 *
 * Every document the store writes is stringified on its own and wrapped by this,
 * which is what makes an append a byte-level concatenation rather than a
 * re-serialization of the whole stream.
 *
 * The ids in the markers are what makes union merge safe, and they are not
 * decoration. `merge=union` (ADR-0019) resolves two appends by keeping both
 * sides' lines — but before it does, git trims whatever leading and trailing
 * lines the two sides have in common. With a bare `---` separator both sides
 * open with the same line, so git emits it once and splices two events into one
 * document, where the later keys win and an event is silently lost. Concurrent
 * `resolved` events, identical but for their ids, lose their trailing lines the
 * same way.
 *
 * Tagging both markers with the event id makes every appended block differ from
 * every other at its first and last line, so there is nothing for git to trim
 * and each document survives a merge whole. `... ` is YAML's document-end
 * marker, so this is structure rather than a comment convention — it says the
 * document is closed, which is exactly the append-only invariant.
 */
function wrapDocument(id: string, yaml: string): string {
  return `--- # ${id}\n${yaml}... # ${id}\n`;
}

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
  authorKind?: unknown;
  timestamp: string;
  promotedFrom?: {
    conversationId?: unknown;
    commentIds?: unknown;
  };
}

/** Shape of an event document as read from YAML (docs 1..n), before validation. */
interface YamlEvent {
  id?: unknown;
  type?: unknown;
  timestamp?: unknown;
  author?: unknown;
  authorKind?: unknown;
  target?: unknown;
  body?: unknown;
  emoji?: unknown;
  threadId?: unknown;
  commentIds?: unknown;
}

/**
 * `agent` when the document says so, otherwise nothing.
 *
 * Absent means human, and so does any value this version doesn't recognise: a
 * committed Sidecar can be written by a newer Scholia, and an unreadable author
 * kind is not a reason to refuse the Comment underneath it.
 */
function readAuthorKind(value: unknown): { authorKind?: AuthorKind } {
  return value === "agent" ? { authorKind: "agent" } : {};
}

function readPromotedFrom(value: unknown): { conversationId: string; commentIds: string[] } | null {
  if (!value || typeof value !== "object") return null;
  const { conversationId, commentIds } = value as Record<string, unknown>;
  if (typeof conversationId !== "string") return null;
  if (!Array.isArray(commentIds) || !commentIds.every((id) => typeof id === "string")) {
    return null;
  }
  return { conversationId, commentIds };
}

export class SidecarStore implements ConversationRepository {
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  private dirFor(visibility: Visibility): string {
    return join(sidecarDir(this.rootDir), DIR_FOR[visibility]);
  }

  private filePathFor(conversationId: string, visibility: Visibility): string {
    if (!UUID_RE.test(conversationId)) {
      throw new Error(`not a Conversation id: ${conversationId}`);
    }
    return join(this.dirFor(visibility), `${conversationId}.yaml`);
  }

  /**
   * Where a Conversation is, and therefore what it is.
   *
   * An id says nothing about visibility, so both directories are tried. The one
   * the file turns up in *is* the answer — this is the only place visibility is
   * ever decided (ADR-0019).
   */
  private async locate(
    conversationId: string,
  ): Promise<{ filePath: string; visibility: Visibility } | null> {
    for (const visibility of ALL_VISIBILITIES) {
      const filePath = this.filePathFor(conversationId, visibility);
      try {
        await readFile(filePath, "utf8");
        return { filePath, visibility };
      } catch {
        // Not here. Try the other directory.
      }
    }
    return null;
  }

  async createConversation(input: CreateConversationInput): Promise<Conversation> {
    await ensureSidecarLayout(this.rootDir);

    const { header, firstComment } = input;
    // Public unless told otherwise — a Thread is the default for review comments.
    const visibility = input.visibility ?? "public";
    const events: ConversationEvent[] = [firstComment, ...(input.events ?? [])];

    // Build the multi-document YAML stream: doc 0 = header, doc 1 = first event.
    // Each document is stringified individually and joined with `---\n`, which is
    // the YAML multi-document separator that parseAllDocuments expects.
    // The yaml library automatically uses block scalars (`|`) for multi-line
    // bodies, so no body content — including `---`, YAML syntax, or markdown —
    // can escape its field or corrupt the document structure.
    const docs = [
      wrapDocument(
        header.id,
        stringify({
          id: header.id,
          page: header.page,
          anchor: header.anchor,
          // Omitted rather than written as `null` when absent, so a header
          // carries no field it has nothing to say about.
          ...(header.contentHash ? { contentHash: header.contentHash } : {}),
          ...(header.provenance ? { provenance: header.provenance } : {}),
          author: header.author,
          ...(header.authorKind === "agent" ? { authorKind: header.authorKind } : {}),
          timestamp: header.timestamp,
          ...(header.promotedFrom
            ? {
                promotedFrom: {
                  conversationId: header.promotedFrom.conversationId,
                  commentIds: header.promotedFrom.commentIds,
                },
              }
            : {}),
          // No `visibility` — that is the directory this file is about to go in.
        }),
      ),
      ...events.map(stringifyEvent),
    ];

    const yamlStream = docs.join("");

    // Atomic write: write to a temp file, then rename onto the final path.
    // rename(2) is atomic on the same filesystem, so a reader never sees a
    // partially-written file. Promotion relies on this covering *every* event it
    // was given, not just the first (see CreateConversationInput.events).
    const filePath = this.filePathFor(header.id, visibility);
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

    return foldConversation(header, events, visibility);
  }

  async appendEvent(conversationId: string, event: ConversationEvent): Promise<void> {
    // The aggregate has to exist before it can be appended to — an append onto a
    // missing file would create a stream with no header, which nothing can fold.
    // Locating it is also what keeps a reply to a Chat in the Chat: the event
    // goes where the Conversation already is, and the caller never names a
    // directory.
    const found = await this.locate(conversationId);
    if (!found) {
      throw new Error(`no Conversation ${conversationId} in the Sidecar`);
    }

    // O_APPEND, not read-modify-write. Two writers (a preview server and an
    // agent driving the CLI in-process, ADR-0020) can be appending to the same
    // Conversation, and every document the store writes ends in a newline, so
    // concurrent appends interleave whole documents rather than corrupting one.
    await appendFile(found.filePath, stringifyEvent(event), { flag: "a" });
  }

  async getConversation(conversationId: string): Promise<Conversation | null> {
    // Validated before anything is read: an id that is not a UUID is a caller
    // trying to walk out of the store's directories, and must stay loud rather
    // than come back as an ordinary "no such Conversation".
    this.filePathFor(conversationId, "public");

    const found = await this.locate(conversationId);
    if (!found) return null;

    const raw = await readFile(found.filePath, "utf8").catch(() => null);
    if (raw === null) return null;
    return parseStream(raw, found.visibility);
  }

  async listConversations(pagePath?: string): Promise<Conversation[]> {
    await ensureSidecarLayout(this.rootDir);

    const conversations: Conversation[] = [];

    // Both directories, each Conversation carrying the visibility of the one it
    // came out of. Who may see a Chat is the caller's question, not the store's
    // — locally the reader owns every Chat in their own tree (CONTEXT "Viewer").
    for (const visibility of ALL_VISIBILITIES) {
      const dir = this.dirFor(visibility);
      const entries = await readdir(dir).catch(() => [] as string[]);

      for (const entry of entries) {
        if (!entry.endsWith(".yaml")) continue;

        const raw = await readFile(join(dir, entry), "utf8").catch(() => null);
        if (raw === null) continue;
        const conversation = parseStream(raw, visibility);
        // Filter by page — a Conversation is on exactly one Page (CONTEXT
        // "Page"). No path asked for means every Page.
        if (!conversation) continue;
        if (pagePath !== undefined && conversation.header.page !== pagePath) continue;

        conversations.push(conversation);
      }
    }

    return conversations;
  }
}

/**
 * One YAML stream — header plus events — folded into a Conversation.
 *
 * `visibility` is passed in rather than read out: it is not in the stream, and
 * the only thing that knows it is the directory the bytes came from (ADR-0019).
 */
function parseStream(raw: string, visibility: Visibility): Conversation | null {
  const docs = parseAllDocuments(raw);
  if (docs.length < 2) return null;

  const headerDoc = docs[0]!.toJSON() as YamlHeader | null;
  if (!headerDoc) return null;

  const promotedFrom = readPromotedFrom(headerDoc.promotedFrom);
  const header: ConversationHeader = {
    id: headerDoc.id,
    page: headerDoc.page,
    anchor: headerDoc.anchor as Anchor | null,
    ...(headerDoc.contentHash ? { contentHash: headerDoc.contentHash } : {}),
    ...(headerDoc.provenance ? { provenance: headerDoc.provenance } : {}),
    author: headerDoc.author,
    ...readAuthorKind(headerDoc.authorKind),
    timestamp: headerDoc.timestamp,
    ...(promotedFrom ? { promotedFrom } : {}),
  };

  const events: ConversationEvent[] = [];
  for (let i = 1; i < docs.length; i++) {
    const event = readEvent(docs[i]!.toJSON() as YamlEvent | null);
    if (event) events.push(event);
  }

  return foldConversation(header, events, visibility);
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

  const base = { id, timestamp, author, ...readAuthorKind(doc.authorKind) };
  const target = typeof doc.target === "string" ? doc.target : null;
  const body = typeof doc.body === "string" ? doc.body : null;
  const emoji = typeof doc.emoji === "string" ? doc.emoji : null;
  const threadId = typeof doc.threadId === "string" ? doc.threadId : null;
  const commentIds = Array.isArray(doc.commentIds)
    ? doc.commentIds.filter((item): item is string => typeof item === "string")
    : null;

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
    case "promoted":
      return threadId === null || commentIds === null
        ? null
        : { ...base, type, threadId, commentIds };
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
  return wrapDocument(
    event.id,
    stringify({
      id: event.id,
      type: event.type,
      timestamp: event.timestamp,
      author: event.author,
      // Only ever present for an agent, so a person's document is byte-identical
      // to what this store has always written (see `AuthorKind` in core).
      ...(event.authorKind === "agent" ? { authorKind: event.authorKind } : {}),
      ...("target" in event ? { target: event.target } : {}),
      ...("emoji" in event ? { emoji: event.emoji } : {}),
      ...("body" in event ? { body: event.body } : {}),
      ...("threadId" in event ? { threadId: event.threadId, commentIds: event.commentIds } : {}),
    }),
  );
}

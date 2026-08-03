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

import { appendFile, readFile, writeFile, mkdir, readdir, rename, unlink } from "node:fs/promises";
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

export const SIDECAR_DIR = ".scholia";
export const CONVERSATIONS_DIR = "conversations";
export const CHATS_DIR = "chats";

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

// What the Chats directory's own `.gitignore` says, and all it ever says.
const IGNORE_EVERYTHING = "*\n";

// The Sidecar's top-level `.gitignore`. Same rule, but with the opt-in written
// down, because ADR-0018 says committing the Sidecar "must be documented loudly;
// nobody will stumble into it" — and because the obvious incantation is wrong.
//
// `!conversations/` does nothing: `*` has no slash in it, so it matches
// `thread.yaml` at any depth, not merely the directory. Re-including the
// directory leaves every file in it still excluded on its own account. The form
// below is the one that actually works, verified against git rather than
// reasoned about.
const SIDECAR_GITIGNORE = `# Scholia's Sidecar: Conversations stored beside the content (ADR-0018).
# Untracked by default, so a repository shared with people who don't use Scholia
# carries no trace of it.
#
# To commit Threads — so Conversations travel with the content and git becomes
# the review channel — add these three lines below the \`*\`:
#
#   !.gitignore
#   !*/
#   !conversations/**
#
# (\`!conversations/\` on its own does nothing: \`*\` matches the files, not just
# the directory.)
#
# Chats are never shareable, whatever this file says. chats/.gitignore ignores
# them unconditionally and git reads it last.
*
`;

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
  authorKind?: unknown;
  timestamp: string;
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

export class SidecarStore implements ConversationRepository {
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  private dirFor(visibility: Visibility): string {
    return join(this.rootDir, SIDECAR_DIR, DIR_FOR[visibility]);
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

  /**
   * Ensure the Sidecar's directories exist, each ignored as it should be.
   *
   * Two different guarantees, which is why the two writes differ:
   *
   * - `.scholia/.gitignore` is written **once**, with `wx`. Nothing in the
   *   Sidecar is tracked by default, but committing Threads so they travel with
   *   the content is a deliberate per-repo opt-in (ADR-0018) — and that opt-in
   *   is made by editing this file, so we must never write over it.
   * - `.scholia/chats/.gitignore` is **re-asserted every time**, because a Chat
   *   is private by construction rather than by policy. It is also the file git
   *   consults last for anything under `chats/`, so it wins over any `!chats/`
   *   someone puts in the parent: a Chat cannot be opted into sharing.
   */
  private async ensureDir(): Promise<void> {
    await mkdir(this.dirFor("public"), { recursive: true });
    await mkdir(this.dirFor("private"), { recursive: true });

    try {
      await writeFile(join(this.rootDir, SIDECAR_DIR, ".gitignore"), SIDECAR_GITIGNORE, {
        flag: "wx",
      });
    } catch {
      // Already there, quite possibly with a repo's opt-in in it. Leave it alone.
    }

    // Written only when it doesn't already say the right thing, so the common
    // case is a read rather than a write — but written unconditionally when it
    // does not, including over an edit that tried to weaken it.
    const chatsIgnore = join(this.dirFor("private"), ".gitignore");
    const current = await readFile(chatsIgnore, "utf8").catch(() => null);
    if (current !== IGNORE_EVERYTHING) {
      await writeFile(chatsIgnore, IGNORE_EVERYTHING).catch(() => {
        // A Sidecar on a read-only tree can still be read. Failing the whole
        // operation over the ignore file would make that impossible.
      });
    }
  }

  async createConversation(input: CreateConversationInput): Promise<Conversation> {
    await this.ensureDir();

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
      stringify({
        id: header.id,
        page: header.page,
        anchor: header.anchor,
        // Omitted rather than written as `null` when absent, so a header carries
        // no field it has nothing to say about.
        ...(header.contentHash ? { contentHash: header.contentHash } : {}),
        ...(header.provenance ? { provenance: header.provenance } : {}),
        author: header.author,
        ...(header.authorKind === "agent" ? { authorKind: header.authorKind } : {}),
        timestamp: header.timestamp,
        // No `visibility` — that is the directory this file is about to go in.
      }),
      ...events.map(stringifyEvent),
    ];

    const yamlStream = docs.join(DOC_SEPARATOR);

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
    await appendFile(found.filePath, DOC_SEPARATOR + stringifyEvent(event), { flag: "a" });
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

  async listConversations(pagePath: string): Promise<Conversation[]> {
    await this.ensureDir();

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
        // Filter by page — a Conversation is on exactly one Page (CONTEXT "Page").
        if (!conversation || conversation.header.page !== pagePath) continue;

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

  const header: ConversationHeader = {
    id: headerDoc.id,
    page: headerDoc.page,
    anchor: headerDoc.anchor as Anchor | null,
    ...(headerDoc.contentHash ? { contentHash: headerDoc.contentHash } : {}),
    ...(headerDoc.provenance ? { provenance: headerDoc.provenance } : {}),
    author: headerDoc.author,
    ...readAuthorKind(headerDoc.authorKind),
    timestamp: headerDoc.timestamp,
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
    // Only ever present for an agent, so a person's document is byte-identical
    // to what this store has always written (see `AuthorKind` in core).
    ...(event.authorKind === "agent" ? { authorKind: event.authorKind } : {}),
    ...("target" in event ? { target: event.target } : {}),
    ...("emoji" in event ? { emoji: event.emoji } : {}),
    ...("body" in event ? { body: event.body } : {}),
  });
}

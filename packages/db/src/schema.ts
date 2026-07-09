// Drizzle schema for collab's mutable metadata (PLAN §3, ADR-0004). Immutable
// content (raw sources, rendered HTML, serialized Source Maps) lives in the
// content-addressed blob store, not here — these tables only reference blobs by
// their content hash.
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ---- Enums ----
export const siteState = pgEnum("site_state", ["open", "read_only", "frozen"]);
export const tokenKind = pgEnum("token_kind", ["owner", "viewer"]);
export const manifestKind = pgEnum("manifest_kind", ["markdown", "html", "asset"]);
export const visibility = pgEnum("visibility", ["private", "public"]);
export const anchorStatus = pgEnum("anchor_status", ["live", "outdated"]);
export const commentOrigin = pgEnum("comment_origin", ["collab", "github"]);
export const mirrorStatus = pgEnum("mirror_status", [
  "pending",
  "synced",
  "failed",
  "detached",
]);

// ---- jsonb shapes (documented as TS types; stored as jsonb) ----
export interface MirrorBinding {
  provider: string;
  repo: string;
  prNumber: number;
}

export interface ContentSource {
  kind: "local" | "ref" | "pr";
  ref?: string;
  prNumber?: number;
}

export interface Provenance {
  remote?: string;
  sha?: string;
  branch?: string;
  dirty?: boolean;
}

export interface TextQuote {
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface Anchor {
  textQuote: TextQuote;
  sourceRange?: { start: number; end: number };
  xpath?: string;
  css?: string;
}

export interface Identity {
  name: string;
  kind: "human" | "agent";
  tier: "owner" | "viewer";
  onBehalfOf?: string;
  source: "native" | "github";
}

// ---- Tables ----

// The unit of upload and sharing. Versioning, ownership, and the access gate
// all live at the Site level.
export const sites = pgTable("sites", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(), // the Share URL
  state: siteState("state").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Set for a PR-backed Site (M10), otherwise null.
  mirrorBinding: jsonb("mirror_binding").$type<MirrorBinding>(),
});

// Capability tokens (ADR-0005/0006), stored hashed. Rotation = new row, revoke old.
export const siteTokens = pgTable("site_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  kind: tokenKind("kind").notNull(),
  label: text("label"),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  // Viewer-scoped agent tokens (M8, ADR-0006 tier 2) bind to the Viewer they
  // authorize. Null for owner-kind tokens.
  viewerId: uuid("viewer_id").references(() => viewers.id, { onDelete: "cascade" }),
});

// An immutable snapshot of an entire Site created by an upload.
export const versions = pgTable("versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  contentSource: jsonb("content_source").$type<ContentSource>().notNull(),
  provenance: jsonb("provenance").$type<Provenance>(),
  isLatest: boolean("is_latest").notNull().default(false),
});

// One Page or Asset within a Version. Content is referenced by hash; the bytes
// live in the blob store. Identity of a Page across Versions is its `path`.
export const manifestEntries = pgTable(
  "manifest_entries",
  {
    versionId: uuid("version_id")
      .notNull()
      .references(() => versions.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    kind: manifestKind("kind").notNull(),
    contentHash: text("content_hash").notNull(),
    title: text("title"),
    renderedHash: text("rendered_hash"),
    sourceMapHash: text("source_map_hash"),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.path] })],
);

// An anonymous human identity minted client-side (ADR-0006). A future
// logged-in user is just a durable Viewer.
export const viewers = pgTable("viewers", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// The single entity for all discussion — a Chat (private) or Thread (public).
export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  createdVersionId: uuid("created_version_id")
    .notNull()
    .references(() => versions.id),
  pagePath: text("page_path"), // null = page-level (no anchor)
  visibility: visibility("visibility").notNull(),
  ownerViewerId: uuid("owner_viewer_id").references(() => viewers.id), // for private Chats
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: text("resolved_by"),
  anchor: jsonb("anchor").$type<Anchor>(),
  anchorStatus: anchorStatus("anchor_status").notNull().default("live"),
});

// A single message within a Conversation, bound to the Version it was made on.
export const comments = pgTable("comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  versionId: uuid("version_id")
    .notNull()
    .references(() => versions.id),
  author: jsonb("author").$type<Identity>().notNull(),
  origin: commentOrigin("origin").notNull().default("collab"),
  body: text("body").notNull(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }), // tombstone
  // Promotion (M8) hides non-selected Chat messages from all listings without
  // tombstoning them.
  hiddenAt: timestamp("hidden_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // M5 deviation from PLAN §3: authorViewerId mirrors conversations.ownerViewerId,
  // enabling anonymous Viewers (localStorage-grade identity, CONTEXT "Viewer") to
  // edit/delete their OWN comments. Null for future agent/owner-token authors.
  authorViewerId: uuid("author_viewer_id").references(() => viewers.id, {
    onDelete: "set null",
  }),
});

// Outbound mirror state + dedup map (M10). external_id <-> comment_id prevents
// echo loops.
export const commentMirrors = pgTable(
  "comment_mirrors",
  {
    commentId: uuid("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    externalUrl: text("external_url"),
    status: mirrorStatus("status").notNull().default("pending"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.provider] })],
);

// Emoji from a fixed review-oriented palette. Imported GitHub reactions carry
// author.source = github; reactions are not mirrored outbound.
export const reactions = pgTable("reactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  commentId: uuid("comment_id")
    .notNull()
    .references(() => comments.id, { onDelete: "cascade" }),
  author: jsonb("author").$type<Identity>().notNull(),
  emoji: text("emoji").notNull(),
  // M5 deviation from PLAN §3: authorViewerId enables reaction TOGGLE keyed by
  // (commentId, emoji, viewerId) for anonymous Viewer identity (CONTEXT "Viewer").
  // Null for future agent/owner-token authors.
  authorViewerId: uuid("author_viewer_id").references(() => viewers.id, {
    onDelete: "set null",
  }),
});

// An @-reference to an existing Identity on the Site, used to route feedback.
export const mentions = pgTable("mentions", {
  commentId: uuid("comment_id")
    .notNull()
    .references(() => comments.id, { onDelete: "cascade" }),
  targetIdentity: text("target_identity").notNull(),
});

// The Version a given viewer most recently looked at — the baseline for the
// "what changed" diff and "new since" summary counts.
export const viewerState = pgTable(
  "viewer_state",
  {
    viewerId: uuid("viewer_id")
      .notNull()
      .references(() => viewers.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    lastSeenVersionId: uuid("last_seen_version_id").references(() => versions.id),
  },
  (t) => [primaryKey({ columns: [t.viewerId, t.siteId] })],
);

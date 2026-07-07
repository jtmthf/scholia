// Anchoring (M5, ADR-0002): text-quote primary + secondary source-range mapping.
export type { TextQuote, SourceRange, Anchor, SelectionCandidate } from "./types.js";
export { searchQuote } from "./quote.js";
export { mapSmIdsToSourceRange } from "./source-range.js";
// Cross-Version migration (M6): re-resolve a text-quote against a new Version.
export { migrateAnchor, type AnchorStatus, type MigrationResult } from "./migrate.js";

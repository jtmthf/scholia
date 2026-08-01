// @scholia/sidecar — the Sidecar: Conversations persisted in the repository,
// beside the content (ADR-0018), as one append-only YAML stream per Conversation
// (ADR-0019). This is the filesystem outbound adapter for `core`'s
// ConversationRepository port, in its own package because both delivery surfaces
// need it: `@scholia/local` serves it to a browser and `@scholia/cli` drives it
// from `scholia comment` (ADR-0020).

export { SidecarStore, SIDECAR_DIR, CONVERSATIONS_DIR } from "./store.js";
export { resolveAuthor } from "./author.js";

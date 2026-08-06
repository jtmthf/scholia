// @scholia/sidecar — the Sidecar: Conversations persisted in the repository,
// beside the content (ADR-0018), as one append-only YAML stream per Conversation
// (ADR-0019). This is the filesystem outbound adapter for `core`'s
// ConversationRepository port, in its own package because both delivery surfaces
// need it: `@scholia/local` serves it to a browser and `@scholia/cli` drives it
// from `scholia comment` (ADR-0020).

export { SidecarStore } from "./store.js";
export {
  SIDECAR_DIR,
  CONVERSATIONS_DIR,
  CHATS_DIR,
  ensureSidecarLayout,
  isCommitted,
  sidecarDir,
} from "./layout.js";
export {
  commitSidecar,
  uncommitSidecar,
  type CommitSidecarResult,
  type UncommitSidecarResult,
} from "./tracking.js";
export { resolveAuthor } from "./author.js";
// The local target for the agent verb set: the application layer invoked
// in-process against this Sidecar, with no server running (ADR-0020).
export { createLocalApi, type LocalApiOptions } from "./local-api.js";

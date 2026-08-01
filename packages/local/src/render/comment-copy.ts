// Comment-layer copy the server and the client must both render identically.
//
// The rail is server-rendered and then hydrated (ADR-0031), so any string that
// differs between the two sides is a hydration correction the reader can see.
// Keeping them here makes that a compile-time fact rather than a comment asking
// two files to stay in step.
//
// Deliberately free of imports: this module is bundled into the browser client
// as well as the CLI, and it must not drag anything behind it.

/**
 * What the Outdated section says these Conversations no longer match.
 *
 * The consumer's words, because what they drifted from differs: a hosted Site
 * has Versions to name, Local Preview only has the file as it now stands
 * (CONTEXT "Version").
 */
export const OUTDATED_NOTE = "These Conversations no longer match the file as it now stands.";

/**
 * The rail's empty state.
 *
 * `@scholia/ui`'s default offers a private Chat as well, which is true of the
 * hosted viewer and not of Local Preview — Chats are a separate ticket (#31),
 * and copy that promises an affordance the surface doesn't have is worse than
 * no copy at all.
 */
export const EMPTY_NOTE =
  "No Conversations yet. Select text in the Page to start one, or comment on the whole Page.";

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
 * Local Preview's own wording for `@scholia/ui`'s default, in this package's
 * vocabulary (Page, Conversation) rather than the hosted viewer's.
 */
export const EMPTY_NOTE =
  "No Conversations yet. Select text in the Page to start a Thread or a private Chat, or comment on the whole Page.";

/**
 * What the Promote dialog says promoting a Chat will do here.
 *
 * Different from `@scholia/ui`'s default, and it has to be. Hosted, visibility
 * is a column and the Chat becomes the Thread; locally it is a directory
 * (ADR-0019), so Promotion writes a *new* Thread and the Chat stays private and
 * in place. There is also no Share URL to warn anyone about — a local Thread is
 * seen by whoever can read the repository.
 */
export const PROMOTE_NOTE =
  "Choose which messages become public. Scholia writes them into a new Thread beside the content; this Chat stays private and unchanged.";

/**
 * What the Chats section says about who can see a Chat.
 *
 * `@scholia/ui`'s default says "you and your agents", which is true hosted,
 * where privacy is a Viewer token. Locally it is the filesystem: a Chat is in a
 * directory git is told never to track, so what actually keeps it private is
 * that it never leaves the machine.
 */
export const CHATS_NOTE = "Visible only to you and your agents. Never committed to git.";

// Why a Conversation command was refused, in a form a delivery surface can map.
//
// The message is written to be shown to a reader — `@scholia/ui` renders whatever
// a rejection carries (ADR-0030) — and the `code` says which *kind* of refusal it
// is, so a transport can pick its own answer without pattern-matching on prose.
//
// Deliberately no HTTP here: core is pure domain (CLAUDE.md), and a status code
// is the delivery layer's vocabulary. `packages/local/src/server.ts` maps these
// three codes onto statuses; a CLI maps them onto exit codes and says nothing
// about 403.

export type ConversationErrorCode =
  /** No such Conversation or Comment. */
  | "not-found"
  /** The acting author isn't allowed to do this. */
  | "forbidden"
  /** The request itself is malformed — an emoji outside the palette, say. */
  | "invalid";

export class ConversationError extends Error {
  readonly code: ConversationErrorCode;

  constructor(code: ConversationErrorCode, message: string) {
    super(message);
    this.name = "ConversationError";
    this.code = code;
  }
}

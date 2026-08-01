// Why a Conversation command was refused, in a form a delivery surface can map.
//
// The message is written to be shown to a reader — `@scholia/ui` renders whatever
// a rejection carries (ADR-0030) — and the `code` is what a transport needs to
// pick a status without pattern-matching on prose.

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

/** The HTTP status a `ConversationError` deserves; 500 for anything else. */
export function conversationErrorStatus(err: unknown): 400 | 403 | 404 | 500 {
  if (!(err instanceof ConversationError)) return 500;
  switch (err.code) {
    case "not-found":
      return 404;
    case "forbidden":
      return 403;
    case "invalid":
      return 400;
  }
}

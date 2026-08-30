import { createContext } from "preact";
import { useContext } from "preact/hooks";

/**
 * Verbs the comment layer can back with a `<form>` so the rail works without
 * JavaScript. Each is a single use case; the consumer's `formAction` turns the
 * verb and its target id into an action URL, method and hidden fields.
 */
export type CommentVerb =
  | "page-comment"
  | "reply"
  | "resolve"
  | "reopen"
  | "react"
  | "edit"
  | "delete-comment"
  | "delete-conversation"
  | "promote";

/**
 * What `formAction` returns: enough to render a `<form>` that submits the same
 * use case the port's async method would call. The consumer constructs the URL;
 * the layer never does (ADR-0030).
 */
export interface FormAction {
  action: string;
  method: "POST";
  hidden: Array<{ name: string; value: string }>;
}

/**
 * Everything the comment layer needs from the outside world, and the only way it
 * reaches it. The components render the Conversations they are handed and call
 * these methods to change them; they never construct a request, hold a credential,
 * or know where the data came from.
 *
 * Two consequences worth being explicit about, because they are what makes the
 * layer portable:
 *
 * - **Identity is the port's business.** Every method resolves the acting Identity
 *   itself (minting a Viewer hosted, reading git config locally — CONTEXT
 *   "Identity"). The components only ever surface `displayName`, because a reader
 *   who hasn't got one yet has to be asked for it in the Composer.
 * - **Refreshing is the port's business.** Methods resolve when the mutation has
 *   landed *and* the Conversations the consumer passes down reflect it. A consumer
 *   with a query cache invalidates; one holding plain state refetches. The
 *   components hold no copy to update, so there is nothing for them to get wrong.
 *
 * - **An optional method is a surface the consumer doesn't have.** The same
 *   pattern as `Rail`'s optional `onBringAgent`: where a method is absent, the
 *   affordance that would call it isn't rendered at all, rather than rendered and
 *   failing. Local Preview supplies everything the Sidecar can write; the hosted
 *   viewer omits the forms it has no token surface for.
 *
 * Methods reject with an `Error` whose message is fit to show a reader; the
 * component that initiated the call renders it inline.
 */
export interface CommentsPort {
  /** The reader's display name, or null if they haven't given one yet. */
  displayName: string | null;
  /** Whether this reader may delete anyone's Conversation (CONTEXT "Owner"). */
  canModerate: boolean;

  /**
   * Post a reply. `displayName` is what the reader just typed — empty when they
   * already have one, in which case the port falls back to the stored name.
   */
  addComment(conversationId: string, input: { body: string; displayName: string }): Promise<void>;
  /** Omit to render Comments without an Edit affordance. */
  editComment?(commentId: string, input: { body: string }): Promise<void>;
  /** Omit to render Comments without a Delete affordance. */
  deleteComment?(commentId: string): Promise<void>;
  /** Omit to render Comments with no Reactions row at all (CONTEXT "Reaction"). */
  toggleReaction?(commentId: string, emoji: string): Promise<void>;
  /** Omit to render Conversations without Resolve/Reopen. */
  setResolved?(conversationId: string, resolved: boolean): Promise<void>;
  /** Flip a Chat to a public Thread (CONTEXT "Promotion"). */
  promote?(
    conversationId: string,
    input: { commentIds: string[]; summary?: string },
  ): Promise<void>;
  /** Owner moderation — delete a whole Conversation. Gated on `canModerate`. */
  deleteConversation?(conversationId: string): Promise<void>;

  /**
   * Optional: when present, action controls render as `<form>` elements so the
   * rail is usable with JavaScript disabled. The consumer supplies the URL and
   * hidden fields; the layer supplies the visible fields and the submit handler
   * that `preventDefault`s when JavaScript is running (ADR-0034).
   */
  formAction?(verb: CommentVerb, id: string): FormAction;
}

const CommentsContext = createContext<CommentsPort | null>(null);

export const CommentsProvider = CommentsContext.Provider;

export function useComments(): CommentsPort {
  const port = useContext(CommentsContext);
  if (!port) throw new Error("@scholia/ui comment components need a <CommentsProvider>.");
  return port;
}

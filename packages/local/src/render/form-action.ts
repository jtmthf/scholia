// The no-JS form surface for Local Preview (ADR-0034).
//
// Both the server render and the hydrated client need to produce the same
// `<form>` markup, so the URL scheme and hidden fields live in one place.
// `@scholia/ui` never constructs a URL (ADR-0030); the consumer does, via the
// port's `formAction`.

import type { CommentVerb, FormAction } from "@scholia/ui";

export interface FormActionContext {
  pagePath: string;
  contentHash: string;
  conversationOf(commentId: string): string;
}

function conversationUrl(conversationId: string, action: string): string {
  return `/__conversations/${encodeURIComponent(conversationId)}/${action}`;
}

function commentUrl(conversationId: string, commentId: string, action: string): string {
  return `${conversationUrl(conversationId, "comments")}/${encodeURIComponent(commentId)}/${action}`;
}

export function buildFormAction(ctx: FormActionContext, verb: CommentVerb, id: string): FormAction {
  const pageField = { name: "page", value: ctx.pagePath };

  switch (verb) {
    case "page-comment":
      return {
        action: "/__conversations",
        method: "POST",
        hidden: [
          pageField,
          { name: "contentHash", value: ctx.contentHash },
          { name: "visibility", value: "public" },
        ],
      };
    case "reply":
      return {
        action: conversationUrl(id, "comments"),
        method: "POST",
        hidden: [pageField],
      };
    case "resolve":
      return {
        action: conversationUrl(id, "resolve"),
        method: "POST",
        hidden: [pageField, { name: "resolved", value: "true" }],
      };
    case "reopen":
      return {
        action: conversationUrl(id, "resolve"),
        method: "POST",
        hidden: [pageField, { name: "resolved", value: "false" }],
      };
    case "edit": {
      const conversationId = ctx.conversationOf(id);
      return {
        action: commentUrl(conversationId, id, "edit"),
        method: "POST",
        hidden: [pageField],
      };
    }
    case "delete-comment": {
      const conversationId = ctx.conversationOf(id);
      return {
        action: commentUrl(conversationId, id, "delete"),
        method: "POST",
        hidden: [pageField],
      };
    }
    case "react": {
      const conversationId = ctx.conversationOf(id);
      return {
        action: commentUrl(conversationId, id, "reactions"),
        method: "POST",
        hidden: [pageField],
      };
    }
    case "delete-conversation":
      return {
        action: conversationUrl(id, "delete"),
        method: "POST",
        hidden: [pageField],
      };
    case "promote":
      return {
        action: conversationUrl(id, "promote"),
        method: "POST",
        hidden: [pageField],
      };
  }
}

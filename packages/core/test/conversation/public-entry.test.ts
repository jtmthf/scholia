import { describe, expect, test } from "vitest";
import {
  ConversationError,
  appendComment,
  createConversation,
  foldConversation,
} from "@scholia/core/conversation";

describe("@scholia/core/conversation", () => {
  test("exposes the Conversation domain without the main entry point", () => {
    expect(foldConversation).toBeTypeOf("function");
    expect(createConversation).toBeTypeOf("function");
    expect(appendComment).toBeTypeOf("function");
    expect(ConversationError).toBeTypeOf("function");
  });
});

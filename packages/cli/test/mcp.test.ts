// `scholia mcp` end to end, over the protocol (ADR-0021).
//
// The interesting claim is that MCP reaches the application **in-process**: an
// agent that cannot spawn a preview, has no token and is standing in a
// repository where Scholia has never run can still leave a Comment, and the
// file lands in the tree. So this drives a real MCP client against a real
// server against a real Sidecar — no server process, no port, no network.

import { expect } from "vitest";
import { test } from "./helpers/tmp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ConversationView } from "@scholia/core";
import { createLocalApi, SidecarStore } from "@scholia/sidecar";
import { buildMcpServer } from "../src/mcp.js";

/** A connected MCP client talking to a server bound to `rootDir`. */
async function connect(rootDir: string): Promise<Client> {
  const server = await buildMcpServer(createLocalApi({ rootDir }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mcp-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

/** The JSON a tool answered with — the same bytes `--json` prints on the CLI. */
function payload(result: unknown): unknown {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return JSON.parse(content[0]!.text);
}

test("an agent can leave a Comment over MCP with no Scholia server running", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const client = await connect(tmp.root);

  const created = payload(
    await client.callTool({
      name: "comment",
      arguments: {
        page: "guide.md",
        body: "the second paragraph contradicts the first",
        anchor: "Guide",
        agent: "Claude Code",
      },
    }),
  ) as ConversationView;

  expect(created.comments[0]!.author_kind).toBe("agent");
  expect(created.anchor?.textQuote?.exact).toBe("Guide");

  // In the tree, in the Sidecar, readable by everything else that reads it.
  const stored = await new SidecarStore(tmp.root).getConversation(created.id);
  expect(stored!.comments[0]!.body).toBe("the second paragraph contradicts the first");
  expect(stored!.visibility).toBe("public");

  await client.close();
});

test("the whole verb set is callable, and the filters come with it", async ({ tmp }) => {
  await tmp.write("guide.md", "# Guide\n");
  const client = await connect(tmp.root);

  const created = payload(
    await client.callTool({
      name: "comment",
      arguments: { page: "guide.md", body: "@claude-code have a look" },
    }),
  ) as ConversationView;

  await client.callTool({
    name: "reply",
    arguments: { conversation: created.id, body: "on it", agent: "Claude Code" },
  });
  await client.callTool({
    name: "react",
    arguments: { conversation: created.id, comment: created.comments[0]!.id, emoji: "👀" },
  });

  const listed = payload(
    await client.callTool({
      name: "list_conversations",
      arguments: { unresolved: true, mentions: "Claude Code" },
    }),
  ) as ConversationView[];

  expect(listed).toHaveLength(1);
  expect(listed[0]!.comments).toHaveLength(2);
  expect(listed[0]!.comments[0]!.reactions[0]!.emoji).toBe("👀");

  await client.callTool({ name: "resolve", arguments: { conversation: created.id } });
  expect(
    payload(await client.callTool({ name: "list_conversations", arguments: { unresolved: true } })),
  ).toEqual([]);

  await client.close();
});

// A required param is required in the schema, not just in the verb: the client
// is told which argument it left out before the call reaches the Sidecar.
test("a missing required argument is refused by the tool's schema", async ({ tmp }) => {
  const client = await connect(tmp.root);

  const result = (await client.callTool({
    name: "reply",
    arguments: { body: "no target" },
  })) as { isError?: boolean; content: Array<{ text: string }> };

  expect(result.isError).toBe(true);
  expect(result.content[0]!.text).toContain("conversation");

  await client.close();
});

// A model can act on "no Conversation <id>"; it can do nothing with a
// transport-level failure.
test("a verb that fails comes back as a tool error the model can read", async ({ tmp }) => {
  const client = await connect(tmp.root);

  const result = (await client.callTool({
    name: "resolve",
    arguments: { conversation: "00000000-0000-7000-8000-000000000001" },
  })) as { isError?: boolean; content: Array<{ text: string }> };

  expect(result.isError).toBe(true);
  expect(result.content[0]!.text).toContain("00000000-0000-7000-8000-000000000001");

  await client.close();
});

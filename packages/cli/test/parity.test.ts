// Capability parity between the CLI and MCP (ADR-0021).
//
// Parity is meant to be structural — both surfaces render the application
// layer's registry, so a verb exists on both or on neither. This asserts that
// the wiring actually holds: it reads the commands cac ended up with and the
// tools a real MCP server reports over `tools/list`, and checks both against
// the registry rather than against each other. A test comparing the two to one
// another would pass happily if a verb went missing from both.

import { expect, test } from "vitest";
import { cac } from "cac";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { toFlagName, VERBS, type ConversationApi } from "@scholia/core";
import { registerVerbCommands } from "../src/verb-cli.js";
import { buildMcpServer } from "../src/mcp.js";

/** A target no test here ever calls — parity is about the surface, not the store. */
const unusedApi = {} as ConversationApi;

/** Every tool the MCP server actually reports, over the protocol. */
async function listTools(): Promise<Array<{ name: string; schema: Record<string, unknown> }>> {
  const server = await buildMcpServer(unusedApi);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "parity-test", version: "0.0.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  await client.close();

  return tools.map((tool) => ({
    name: tool.name,
    schema: (tool.inputSchema.properties ?? {}) as Record<string, unknown>,
  }));
}

/** Every command cac ended up with, as `{ name, signature, flags }`. */
function cliCommands(): Array<{ name: string; signature: string; flags: Set<string> }> {
  const cli = cac("scholia");
  registerVerbCommands(cli, unusedApi);
  return cli.commands.map((command) => ({
    name: command.name,
    signature: command.rawName,
    flags: new Set(command.options.map((option) => option.name)),
  }));
}

test("every verb in the registry is a CLI command", () => {
  const commands = new Set(cliCommands().map((command) => command.name));
  for (const verb of VERBS) expect(commands).toContain(verb.command);
});

test("every verb in the registry is an MCP tool", async () => {
  const tools = new Set((await listTools()).map((tool) => tool.name));
  expect([...tools].sort()).toEqual(VERBS.map((verb) => verb.name).sort());
});

test("the two surfaces expose the same verb set", async () => {
  const tools = new Set((await listTools()).map((tool) => tool.name));
  const commands = new Set(cliCommands().map((command) => command.name));

  // Mapped through the registry, because the two spellings differ on purpose:
  // `list_conversations` is the tool an agent calls, `comments` is what a
  // person types.
  for (const verb of VERBS) {
    expect(tools.has(verb.name), `${verb.name} missing from MCP`).toBe(true);
    expect(commands.has(verb.command), `${verb.command} missing from the CLI`).toBe(true);
  }
  expect(tools.size).toBe(VERBS.length);
});

test("every param a tool takes is reachable as a CLI flag", async () => {
  const tools = new Map((await listTools()).map((tool) => [tool.name, tool.schema]));
  const commands = new Map(cliCommands().map((command) => [command.name, command.flags]));

  for (const verb of VERBS) {
    const schema = tools.get(verb.name)!;
    const flags = commands.get(verb.command)!;
    for (const param of verb.params) {
      expect(Object.keys(schema), `${verb.name}.${param.name}`).toContain(param.name);
      expect([...flags], `${verb.command} --${toFlagName(param.name)}`).toContain(
        toFlagName(param.name),
      );
    }
  }
});

// Positional args, short flags and defaults are what make a CLI pleasant, and
// the registry is not allowed to flatten them (ADR-0021). A positional is still
// accepted as its flag, so this holds without costing parity.
test("positional params keep their place in the command signature", () => {
  const signatures = new Map(cliCommands().map((command) => [command.name, command.signature]));

  expect(signatures.get("reply")).toBe("reply [conversation] [body]");
  expect(signatures.get("react")).toBe("react [conversation] [comment] [emoji]");
  expect(signatures.get("resolve")).toBe("resolve [conversation]");
  expect(signatures.get("comment")).toBe("comment [body]");
  expect(signatures.get("comments")).toBe("comments [page]");
});

test("every verb carries prose written for a model, not a flag list", () => {
  for (const verb of VERBS) {
    expect(verb.description.length, verb.name).toBeGreaterThan(80);
    for (const param of verb.params) {
      expect(param.description.length, `${verb.name}.${param.name}`).toBeGreaterThan(10);
    }
  }
});

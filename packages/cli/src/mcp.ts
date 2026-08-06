// The MCP half of the agent surface: the same verb registry, as tools
// (ADR-0021).
//
// It ships as `scholia mcp` rather than a second package because the CLI is
// already the install — a separate package would mean a second publish, a
// second version, and skew between an MCP and the application it drives.
//
// Both transports are here on purpose. stdio is what an agent with a shell
// spawns; streamable HTTP is what an agent that cannot spawn a process has to
// use, and leaving it out would exclude exactly the clients MCP exists for.
//
// One rule holds this file together: **stdout belongs to the protocol**. In
// stdio mode a stray `console.log` is a corrupt JSON-RPC frame, so everything
// this file says to a human goes to stderr.

import { createServer } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z as Zod, ZodTypeAny } from "zod";
import { VERBS, type ConversationApi, type VerbParam } from "@scholia/core";
import { resolveTarget, type TargetOptions } from "./target.js";

export interface McpOptions extends TargetOptions {
  /** Serve streamable HTTP on this port instead of stdio. */
  http?: number;
}

/**
 * The SDK and zod, loaded when MCP is actually being served.
 *
 * `scholia` is a preview tool first: everything here is dead weight on
 * `scholia <path>` and on every verb run from a shell, and the published binary
 * pays that cost on each invocation if these are imported at the top. The
 * subpaths keep their `.js` — the SDK's exports map names files, and the
 * extensionless form only resolves under a bundler.
 */
async function loadSdk() {
  const [{ McpServer }, { z }] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/mcp.js"),
    import("zod"),
  ]);
  return { McpServer, z };
}

/** The MCP input schema for one verb param. */
function schemaFor(z: typeof Zod, param: VerbParam): ZodTypeAny {
  const base =
    param.type === "boolean"
      ? z.boolean()
      : param.type === "string[]"
        ? z.array(z.string())
        : param.choices
          ? z.enum(param.choices as [string, ...string[]])
          : z.string();

  const described = base.describe(param.description);
  return param.required ? described : described.optional();
}

/**
 * Register every verb as a tool.
 *
 * Exported so a test can list what the surface actually exposes rather than
 * what this file was supposed to expose — the parity assertion is only worth
 * anything if it reads the real server.
 */
export function registerVerbTools(server: McpServer, api: ConversationApi, z: typeof Zod): void {
  for (const verb of VERBS) {
    const inputSchema: Record<string, ZodTypeAny> = {};
    for (const param of verb.params) inputSchema[param.name] = schemaFor(z, param);

    server.registerTool(
      verb.name,
      { description: verb.description, inputSchema },
      async (args: Record<string, unknown>) => {
        try {
          const outcome = await verb.run(api, args);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(outcome.data, null, 2) }],
          };
        } catch (err) {
          // Handed back as a tool result rather than thrown: the model can read
          // "--conversation is required" and fix the call, which it cannot do
          // with a transport-level failure.
          return {
            isError: true,
            content: [
              { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
            ],
          };
        }
      },
    );
  }
}

/** A server with every verb on it, bound to one target. */
export async function buildMcpServer(api: ConversationApi, version = "0.0.0"): Promise<McpServer> {
  const { McpServer, z } = await loadSdk();
  const server = new McpServer({ name: "scholia", version });
  registerVerbTools(server, api, z);
  return server;
}

function note(message: string): void {
  process.stderr.write(`[scholia-mcp] ${message}\n`);
}

/**
 * Serve MCP until the process is stopped.
 *
 * The target is resolved once, at startup, so a misconfigured hosted Site fails
 * here — with a sentence on stderr — rather than inside the first tool call an
 * agent makes.
 */
export async function serveMcp(options: McpOptions, version?: string): Promise<void> {
  const api = await resolveTarget(options);

  if (options.http === undefined) {
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    const server = await buildMcpServer(api, version);
    await server.connect(new StdioServerTransport());
    return;
  }

  const { StreamableHTTPServerTransport } =
    await import("@modelcontextprotocol/sdk/server/streamableHttp.js");

  // Stateless: one transport and one server per request, which is what lets a
  // hosted agent make a single POST without holding a session open.
  const httpServer = createServer((req, res) => {
    // `createServer` wants a void-returning listener, so the async body needs
    // its own terminal handler — a rejection here (transport setup, a malformed
    // body) would otherwise become an unhandled rejection and take the process
    // down instead of failing the one request.
    void (async () => {
      try {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        const server = await buildMcpServer(api, version);
        await server.connect(transport);
        await transport.handleRequest(req, res);
      } catch (err) {
        note(`request failed: ${err instanceof Error ? err.message : String(err)}`);
        if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
        if (!res.writableEnded) res.end("Internal Server Error");
      }
    })();
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(options.http, () => {
      note(`streamable HTTP transport listening on port ${options.http}`);
      resolve();
    });
  });
}

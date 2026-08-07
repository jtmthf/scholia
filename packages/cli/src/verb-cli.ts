// The CLI half of the agent surface: the verb registry rendered as commands
// (ADR-0021).
//
// Nothing here decides what a verb *is* — that lives in the application layer,
// which MCP renders from too. What this file decides is how a verb reads at a
// terminal: `scholia reply <conversation> <body>` rather than a wall of long
// flags, with every positional still accepted as its flag so a script written
// against one keeps working.

import type { CAC } from "cac";
import {
  toFlagName,
  VERBS,
  verbPositionals,
  verbSignature,
  type ConversationApi,
  type Verb,
  type VerbInput,
  type VerbParam,
} from "@scholia/core";
import { resolveTarget, type TargetOptions } from "./target.js";

/** The flags every verb carries: which application, and how to print. */
interface CommonOptions extends TargetOptions {
  json?: boolean;
}

function help(param: VerbParam): string {
  const parts = [param.description];
  if (param.choices) parts.push(`One of: ${param.choices.join(", ")}.`);
  if (typeof param.default === "string") parts.push(`Default: ${param.default}.`);
  return parts.join(" ");
}

/** `--emoji <value>`, `-m, --mentions <value>`, or `--chat` for a boolean. */
function flag(param: VerbParam): string {
  const alias = param.cli?.alias ? `-${param.cli.alias}, ` : "";
  const value = param.type === "boolean" ? "" : ` <${param.name}>`;
  return `${alias}--${toFlagName(param.name)}${value}`;
}

/**
 * What the verb was actually given.
 *
 * A positional wins over its flag: someone who typed both meant the one they
 * typed first. Defaults are left to the verb's own reader, so it can tell "not
 * given" from "given the default" — which is what makes `--page` optional on a
 * listing and defaulted on a write.
 */
function collectInput(verb: Verb, args: unknown[], options: Record<string, unknown>): VerbInput {
  const input: VerbInput = { ...options };
  verbPositionals(verb).forEach((param, index) => {
    const value = args[index];
    if (value !== undefined && value !== null && value !== "") input[param.name] = value;
  });
  return input;
}

/** Run one verb and print it, or fail the way every other command fails. */
async function runVerb(
  verb: Verb,
  input: VerbInput,
  options: CommonOptions,
  api?: ConversationApi,
): Promise<void> {
  const target = api ?? (await resolveTarget(options));
  const outcome = await verb.run(target, input);
  // The same answer either way — `--json` picks the machine's presentation of
  // it, which is byte-identical to what MCP returns for the same call.
  console.log(options.json ? JSON.stringify(outcome.data, null, 2) : outcome.lines.join("\n"));
}

/**
 * Register every verb as a CLI command.
 *
 * `api` is for tests: passing one runs the verbs against it instead of
 * resolving a target from flags and the environment.
 */
export function registerVerbCommands(cli: CAC, api?: ConversationApi): void {
  for (const verb of VERBS) {
    // Every positional is optional in cac's sense even when the verb requires
    // it: the same value may arrive as `--conversation`, and a missing required
    // param should be reported by the verb ("--conversation is required")
    // rather than by cac's own arity check, which cannot know that.
    const command = cli.command(verbSignature(verb), verb.summary);

    for (const param of verb.params) command.option(flag(param), help(param));

    // The target and presentation flags, on every verb, so switching a command
    // from the tree to a hosted Site is one flag rather than a different tool.
    command
      .option("--root <dir>", "Project root directory (default: cwd)")
      .option("--server <url>", "Run against a hosted Site rather than the local Sidecar")
      .option("--site <slug>", "Hosted Site slug (defaults to the newest stored credential)")
      .option("--token <token>", "Hosted Site token (defaults to SCHOLIA_TOKEN or the credential)")
      .option("--viewer <id>", "Acting Viewer id, for hosted verbs that check ownership")
      .option("--json", "Print the JSON an agent reads instead of the human listing");

    for (const alias of verb.aliases ?? []) command.alias(alias);

    command.action(async (...args: unknown[]) => {
      const options = (args.pop() ?? {}) as CommonOptions & Record<string, unknown>;
      try {
        await runVerb(verb, collectInput(verb, args, options), options, api);
      } catch (err) {
        console.error(`[scholia] ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
  }
}

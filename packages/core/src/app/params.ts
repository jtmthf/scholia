// What a verb takes, described once so every surface can render it (ADR-0021).
//
// A generic renderer produces uniformly mediocre commands, so a param carries
// its CLI hint — where it sits positionally, its short flag, whether it repeats
// — alongside the prose an LLM reads. The registry constrains *capability*
// parity; the hints are what keep `scholia reply <conversation> <body>` from
// being flattened into a wall of long flags.

/** The value kinds a verb param can take. Deliberately few — this is wire copy. */
export type VerbParamType = "string" | "boolean" | "string[]";

/** How the CLI should render a param, as opposed to how MCP describes it. */
export interface VerbParamCli {
  /**
   * 0-based position in the command signature. A positional is still
   * accepted as `--<name>`, so scripts written against the flag keep working.
   */
  positional?: number;
  /** Short flag, without the dash (`-m`). */
  alias?: string;
}

export interface VerbParam {
  /** camelCase key in the input bag; `--kebab-case` on the CLI. */
  name: string;
  type: VerbParamType;
  /** Written for an LLM, and reused as the CLI flag's help text. */
  description: string;
  required?: boolean;
  /** Applied by the reader when the surface passed nothing. */
  default?: string | boolean;
  /** A closed set — rendered as an enum over MCP and listed in CLI help. */
  choices?: readonly string[];
  cli?: VerbParamCli;
}

/**
 * One call's arguments, before they are read.
 *
 * Loose on purpose: cac produces this from flags and MCP from JSON, and neither
 * can promise more than "some keys, some values". The readers below are where
 * it becomes typed, once, for both.
 */
export type VerbInput = Record<string, unknown>;

/** `--page-path` for a param named `pagePath`. */
export function toFlagName(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function raw(input: VerbInput, param: VerbParam): unknown {
  const value = input[param.name];
  if (value !== undefined && value !== null) return value;
  // cac keeps the raw `--kebab-case` key alongside the camelCase one; MCP only
  // ever sends the camelCase name.
  const flag = input[toFlagName(param.name)];
  return flag === null ? undefined : flag;
}

export class VerbInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerbInputError";
  }
}

/**
 * Read one param out of the bag, applying its default and checking its shape.
 *
 * The error text names the CLI flag rather than the key, because that is what
 * whoever is reading it typed — and an MCP client shows the same text to a
 * model that can map it back to the argument by name.
 */
export function readParam(input: VerbInput, param: VerbParam): string | boolean | string[] {
  const value = raw(input, param);

  if (param.type === "boolean") {
    if (value === undefined) return param.default === true;
    return value === true || value === "true";
  }

  if (param.type === "string[]") {
    // cac hands back a bare string for one `--comment` and an array for
    // several, so both shapes have to arrive as a list. Anything that is not a
    // string is dropped rather than stringified: `[object Object]` is not an id.
    const list = (Array.isArray(value) ? value : [value]).filter(
      (entry): entry is string => typeof entry === "string" && entry.length > 0,
    );
    if (param.required && list.length === 0) {
      throw new VerbInputError(`--${toFlagName(param.name)} is required`);
    }
    return list;
  }

  const text = value === undefined ? param.default : value;
  if (typeof text !== "string" || text.length === 0) {
    if (param.required) throw new VerbInputError(`--${toFlagName(param.name)} is required`);
    return "";
  }
  if (param.choices && !param.choices.includes(text)) {
    throw new VerbInputError(
      `--${toFlagName(param.name)} must be one of ${param.choices.join(", ")}`,
    );
  }
  return text;
}

/** Every param read at once, keyed by name — what a verb's `run` works from. */
export function readInput(
  params: readonly VerbParam[],
  input: VerbInput,
): Record<string, string | boolean | string[]> {
  const out: Record<string, string | boolean | string[]> = {};
  for (const param of params) out[param.name] = readParam(input, param);
  return out;
}

// Typed accessors over a bag already run through `readInput`. A verb knows its
// own params, so a miss here is a bug in the verb rather than bad input.

export function str(values: Record<string, string | boolean | string[]>, name: string): string {
  const value = values[name];
  return typeof value === "string" ? value : "";
}

/** The value, or undefined when it was left out — for genuinely optional params. */
export function optStr(
  values: Record<string, string | boolean | string[]>,
  name: string,
): string | undefined {
  const value = str(values, name);
  return value === "" ? undefined : value;
}

export function bool(values: Record<string, string | boolean | string[]>, name: string): boolean {
  return values[name] === true;
}

export function list(values: Record<string, string | boolean | string[]>, name: string): string[] {
  const value = values[name];
  return Array.isArray(value) ? value : [];
}

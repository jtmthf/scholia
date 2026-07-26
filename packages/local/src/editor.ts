// Editor resolution for the "Open in editor" affordance (ADR-0017). Runs once
// at server start; the result is threaded into `renderPage` so the button is
// simply never rendered when nothing resolves, rather than rendering broken.
import { execFile as execFileCb, spawn } from "node:child_process";
import { promisify } from "node:util";
import { basename } from "node:path";

const execFile = promisify(execFileCb);

export interface ResolvedEditor {
  /** Binary to spawn — a bare name resolved on PATH, or the head of $VISUAL/$EDITOR. */
  command: string;
  /** Any leading args already present in $VISUAL/$EDITOR (e.g. `code -w`). */
  args: string[];
}

// $VISUAL/$EDITOR are as often a terminal editor (vim, nano, ed, ...) as a
// GUI one — spawning those detached with no controlling terminal would be a
// silent no-op at best. ADR-0017: only GUI-shaped binaries are eligible.
const TUI_EDITOR_NAMES = new Set([
  "vi",
  "vim",
  "nvim",
  "emacs",
  "emacs-nox",
  "nano",
  "pico",
  "ed",
  "joe",
  "mcedit",
  "ne",
]);

// PATH search order per ADR-0017, tried after $VISUAL/$EDITOR.
const PATH_CANDIDATES = ["cursor", "code", "zed", "subl", "windsurf"];

function parseEnvEditor(value: string | undefined): ResolvedEditor | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  const bin = parts[0]!;
  const name = basename(bin).toLowerCase().replace(/\.exe$/, "");
  if (TUI_EDITOR_NAMES.has(name)) return null;
  return { command: bin, args: parts.slice(1) };
}

async function commandExists(bin: string): Promise<boolean> {
  const probe = process.platform === "win32" ? "where" : "which";
  try {
    await execFile(probe, [bin]);
    return true;
  } catch {
    return false;
  }
}

// Probes, in order: $VISUAL, then $EDITOR (both only when they look like a
// GUI binary), then cursor/code/zed/subl/windsurf on PATH. Best-effort and
// silent — a miss just means the caller doesn't render the button.
export async function resolveEditor(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedEditor | null> {
  const fromVisual = parseEnvEditor(env.VISUAL);
  if (fromVisual) return fromVisual;

  const fromEditor = parseEnvEditor(env.EDITOR);
  if (fromEditor) return fromEditor;

  for (const bin of PATH_CANDIDATES) {
    if (await commandExists(bin)) return { command: bin, args: [] };
  }
  return null;
}

// Spawns the resolved editor with the target file as its final argument.
// Detached and unreferenced: Local Preview does not wait on the child or
// pipe its output back (ADR-0017) — a hung or crashing editor must not hang
// or crash the preview server.
export function openInEditor(editor: ResolvedEditor, filePath: string): void {
  const child = spawn(editor.command, [...editor.args, filePath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

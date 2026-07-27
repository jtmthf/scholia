// Editor resolution for the "Open in editor" affordance (ADR-0017). Runs once
// at server start; the result is threaded into `renderPage` so "Copy path" is
// rendered in its place when nothing resolves, rather than a broken button.
//
// Resolution is environment-first (ADR-0017 Amendments). A fixed PATH probe
// answers "which editor is installed?"; the question is "which editor is the
// user in?" — and the terminal Scholia was launched from answers it exactly.
import { execFile as execFileCb, spawn } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import { basename, join } from "node:path";

const execFile = promisify(execFileCb);

export interface ResolvedEditor {
  /** Binary to spawn — a bare name resolved on PATH, or the head of $VISUAL/$EDITOR. */
  command: string;
  /** Any leading args already present in $VISUAL/$EDITOR (e.g. `code -w`). */
  args: string[];
  /**
   * Which of the four resolution steps answered. The step that wins *is* the
   * behaviour this module is specified by, and two steps can name the same
   * command — so without this, "did the environment decide, or did the PATH
   * probe?" is unobservable, and that distinction is the whole fix.
   */
  source: "override" | "environment" | "repository" | "path";
}

export interface ResolveEditorOptions {
  /** The served root, searched for repository markers (step 2). */
  rootDir: string;
  env?: NodeJS.ProcessEnv;
  /** `--editor`, or the value persisted in ~/.scholia/config. Wins over detection. */
  override?: string | null | undefined;
  /** Injected in tests so detection never depends on the host's real PATH. */
  commandExists?: (bin: string) => Promise<boolean>;
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
  "helix",
  "hx",
  "kak",
  "micro",
]);

// PATH search order per ADR-0017, tried last of all (step 3).
const PATH_CANDIDATES = ["cursor", "code", "zed", "subl", "windsurf"];

// Cursor, Windsurf, VSCodium and Insiders are VS Code forks: all of them set
// `TERM_PROGRAM=vscode`, so the fork has to be read out of the application
// path VS Code exports into its integrated terminal. Most specific first —
// "code" is a substring of paths belonging to several of the others.
const VSCODE_FORKS: ReadonlyArray<{ marker: string; command: string }> = [
  { marker: "windsurf", command: "windsurf" },
  { marker: "cursor", command: "cursor" },
  { marker: "positron", command: "positron" },
  { marker: "codium", command: "codium" },
  { marker: "code - insiders", command: "code-insiders" },
  { marker: "code-insiders", command: "code-insiders" },
];

// The env vars VS Code (and therefore every fork) sets in its integrated
// terminal that carry the *application's* own path. `VSCODE_IPC_HOOK_CLI` is a
// socket path and only names the app on some platforms — hence the list.
//
// `VSCODE_CWD` is deliberately absent: it holds the user's working directory,
// so previewing `~/src/cursor-notes` from VS Code would resolve to Cursor —
// the exact misdetection this whole module exists to remove.
const VSCODE_PATH_VARS = [
  "VSCODE_GIT_ASKPASS_NODE",
  "VSCODE_GIT_ASKPASS_MAIN",
  "VSCODE_GIT_IPC_HANDLE",
  "VSCODE_IPC_HOOK_CLI",
];

// JetBrains IDEs share one terminal signature (`TERMINAL_EMULATOR`) and do not
// say which IDE it is, so the launcher is picked off PATH. Only reached when
// the user is demonstrably in a JetBrains terminal, so a first match here is a
// far better guess than the same match made blind.
const JETBRAINS_LAUNCHERS = [
  "idea",
  "webstorm",
  "pycharm",
  "phpstorm",
  "rubymine",
  "goland",
  "clion",
  "rider",
  "rustrover",
  "fleet",
];

// Weak second signal (ADR-0017): `.vscode/` in particular is committed by
// people who do not use VS Code, which is why it sorts last of the three.
const REPO_MARKERS: ReadonlyArray<{ dir: string; commands: string[] }> = [
  { dir: ".zed", commands: ["zed"] },
  { dir: ".idea", commands: JETBRAINS_LAUNCHERS },
  { dir: ".vscode", commands: ["code"] },
];

function parseCommand(
  value: string | undefined | null,
): { command: string; args: string[] } | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  return { command: parts[0]!, args: parts.slice(1) };
}

/** True for `vim`, `/usr/bin/nvim`, `nano.exe` — anything that needs a terminal we can't give it. */
export function isTerminalEditor(command: string): boolean {
  const name = basename(command)
    .toLowerCase()
    .replace(/\.exe$/, "");
  return TUI_EDITOR_NAMES.has(name);
}

async function commandOnPath(bin: string): Promise<boolean> {
  const probe = process.platform === "win32" ? "where" : "which";
  try {
    await execFile(probe, [bin]);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  return info?.isDirectory() ?? false;
}

// The three things every detection step needs, resolved once by `resolveEditor`
// and threaded through as one value.
interface Detection {
  env: NodeJS.ProcessEnv;
  rootDir: string;
  exists: (bin: string) => Promise<boolean>;
}

// Returns the first of `candidates` that is installed, or null.
async function firstAvailable(d: Detection, candidates: string[]): Promise<string | null> {
  for (const bin of candidates) {
    if (await d.exists(bin)) return bin;
  }
  return null;
}

// Reads the fork out of the application path VS Code exports into its
// integrated terminal, falling back to plain `code` — an unrecognised fork is
// still a VS Code fork, and that beats falling through to an unrelated editor.
async function resolveVscodeFamily(d: Detection, appPaths: string): Promise<ResolvedEditor | null> {
  const fork = VSCODE_FORKS.find((f) => appPaths.includes(f.marker));
  const command = await firstAvailable(d, fork ? [fork.command, "code"] : ["code"]);
  return command ? { command, args: [], source: "environment" } : null;
}

// Step 1. Which editor's integrated terminal are we running in?
async function fromEnvironment(d: Detection): Promise<ResolvedEditor | null> {
  const termProgram = d.env.TERM_PROGRAM?.toLowerCase();
  const appPaths = VSCODE_PATH_VARS.map((name) => d.env[name] ?? "")
    .join("\n")
    .toLowerCase();

  if (termProgram === "vscode") return resolveVscodeFamily(d, appPaths);

  if (termProgram === "zed" || d.env.ZED_TERM === "true") {
    if (await d.exists("zed")) return { command: "zed", args: [], source: "environment" };
  }

  if (d.env.TERMINAL_EMULATOR?.toLowerCase().includes("jetbrains")) {
    const command = await firstAvailable(d, JETBRAINS_LAUNCHERS);
    if (command) return { command, args: [], source: "environment" };
  }

  // Last within this step, not first: the VSCODE_* vars are inherited by every
  // descendant process, so on their own they only mean "something in this
  // process's ancestry was VS Code". That's the right answer under a
  // multiplexer (tmux and zellij overwrite TERM_PROGRAM with their own name),
  // and the wrong one for a terminal that named itself above.
  if (appPaths.trim()) return resolveVscodeFamily(d, appPaths);

  return null;
}

// Step 2. Repository markers — a weak signal, only trusted when the editor it
// names is actually installed.
async function fromRepositoryMarkers(d: Detection): Promise<ResolvedEditor | null> {
  for (const marker of REPO_MARKERS) {
    if (!(await isDirectory(join(d.rootDir, marker.dir)))) continue;
    const command = await firstAvailable(d, marker.commands);
    if (command) return { command, args: [], source: "repository" };
  }
  return null;
}

// Step 3. The original ADR-0017 probe, now the last resort: $VISUAL / $EDITOR
// when they look like a GUI binary, then the fixed PATH candidate list.
async function fromPath(d: Detection): Promise<ResolvedEditor | null> {
  for (const value of [d.env.VISUAL, d.env.EDITOR]) {
    const parsed = parseCommand(value);
    if (!parsed || isTerminalEditor(parsed.command)) continue;
    // Existence-checked like every other branch: a stale $EDITOR naming an
    // uninstalled binary would otherwise render a button that cannot work.
    if (await editorCommandExists(parsed.command, d.exists)) return { ...parsed, source: "path" };
  }

  const command = await firstAvailable(d, PATH_CANDIDATES);
  return command ? { command, args: [], source: "path" } : null;
}

// A bare name is looked up on PATH; anything with a separator in it is a path
// and is checked on disk.
async function editorCommandExists(
  command: string,
  exists: (bin: string) => Promise<boolean>,
): Promise<boolean> {
  if (!/[\\/]/.test(command)) return exists(command);
  return (await stat(command).catch(() => null))?.isFile() ?? false;
}

// The `--editor` override. Bare names are checked against PATH; anything with
// a separator in it is taken as a path and checked on disk. A terminal editor
// is rejected outright — spawning it detached would do nothing visible.
export type OverrideCheck =
  | { ok: true; editor: ResolvedEditor }
  | { ok: false; reason: "terminal-editor" | "not-found" };

export async function checkEditorOverride(
  value: string,
  commandExists: (bin: string) => Promise<boolean> = commandOnPath,
): Promise<OverrideCheck> {
  const parsed = parseCommand(value);
  if (!parsed) return { ok: false, reason: "not-found" };
  if (isTerminalEditor(parsed.command)) return { ok: false, reason: "terminal-editor" };

  if (!(await editorCommandExists(parsed.command, commandExists))) {
    return { ok: false, reason: "not-found" };
  }

  return { ok: true, editor: { ...parsed, source: "override" } };
}

// Resolves the editor to open files in: the override, then the invoking
// environment, then repository markers, then PATH (ADR-0017 Amendments).
// Best-effort and deliberately silent — a miss just means the caller renders
// "Copy path" instead of "Open in editor".
export async function resolveEditor(opts: ResolveEditorOptions): Promise<ResolvedEditor | null> {
  const d: Detection = {
    env: opts.env ?? process.env,
    rootDir: opts.rootDir,
    exists: opts.commandExists ?? commandOnPath,
  };

  if (opts.override) {
    // An override that no longer resolves (an uninstalled editor named in
    // ~/.scholia/config) falls through rather than killing the button.
    const check = await checkEditorOverride(opts.override, d.exists);
    if (check.ok) return check.editor;
  }

  return (await fromEnvironment(d)) ?? (await fromRepositoryMarkers(d)) ?? (await fromPath(d));
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
  // A spawn failure (the binary vanished since the startup probe) arrives as
  // an 'error' event, and an 'error' with no listener is an uncaught exception
  // — which would take the preview server down long after the route already
  // answered. Swallowed on purpose: nothing is waiting on this child, and
  // ADR-0017 keeps editor trouble silent.
  child.on("error", () => {});
  child.unref();
}

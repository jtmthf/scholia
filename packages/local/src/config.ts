// The one piece of persisted config a zero-config tool allows itself
// (ADR-0017): the editor to open files in. It only ever gets written after
// detection has already guessed wrong for someone, via `scholia --editor`.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface LocalConfig {
  /** The `--editor` value: a command, optionally with leading args. */
  editor?: string;
}

// Resolved per call rather than frozen at module load, because `os.homedir()`
// reads $HOME on POSIX — which the tests point at a temp directory.
export function configPath(): string {
  return join(homedir(), ".scholia", "config");
}

// A missing or hand-mangled file is treated as no config at all: this is a
// convenience, and it must never stop the preview from starting.
async function readRawConfig(): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(configPath(), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function loadConfig(): Promise<LocalConfig> {
  const raw = await readRawConfig();
  return typeof raw.editor === "string" ? { editor: raw.editor } : {};
}

// Merges into the file as it is on disk, rather than into the narrowed
// LocalConfig, so a key written by some other command isn't dropped by this one.
export async function saveEditorPreference(editor: string): Promise<void> {
  const file = configPath();
  const next = { ...(await readRawConfig()), editor };
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
}

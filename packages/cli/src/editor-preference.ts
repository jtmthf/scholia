// `--editor` is the one piece of config a zero-config tool allows itself
// (ADR-0017): it only ever gets used after detection has guessed wrong for
// you, so it's persisted the first time and never asked for again.
import { checkEditorOverride, configPath, loadConfig, saveEditorPreference } from "@scholia/local";

// Returns the editor to hand `startServer`, or undefined to let it detect one.
//
// A bad `--editor` throws: silently ignoring what the user just typed would
// leave them staring at the wrong editor with no explanation. A *saved* editor
// that has since been uninstalled only warns, and detection takes over — that
// one is a stale file, not a thing the user is doing right now.
export async function resolveEditorPreference(
  flag: string | undefined,
): Promise<string | undefined> {
  if (flag) {
    const check = await checkEditorOverride(flag);
    if (!check.ok) {
      throw new Error(
        check.reason === "terminal-editor"
          ? `--editor "${flag}": Local Preview opens files in a GUI editor; a terminal editor has no window to open them in.`
          : `--editor "${flag}": not found on PATH.`,
      );
    }
    await saveEditorPreference(flag);
    console.log(`[scholia] editor preference saved to ${configPath()}`);
    return flag;
  }

  const saved = (await loadConfig()).editor;
  if (!saved) return undefined;
  if ((await checkEditorOverride(saved)).ok) return saved;
  console.warn(
    `[scholia] the editor saved in ${configPath()} ("${saved}") is no longer available — detecting one instead.`,
  );
  return undefined;
}

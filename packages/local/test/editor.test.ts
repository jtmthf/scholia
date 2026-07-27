import { describe, expect } from "vitest";
import { test } from "./helpers/tmp.js";
import { checkEditorOverride, openInEditor, resolveEditor } from "../src/editor.js";

// Every case gets a fresh temp dir as the served root: empty, so no repository
// marker (step 2) can accidentally answer a step-1 or step-3 test.

// A PATH probe that answers for a fixed set of binaries, so detection never
// depends on what happens to be installed on the machine running the tests.
const installed =
  (...bins: string[]) =>
  async (bin: string) =>
    bins.includes(bin);

// Every editor is installed — the interesting case, because it's the one where
// a fixed PATH order gives the wrong answer.
const ALL = installed(
  "cursor",
  "code",
  "codium",
  "code-insiders",
  "windsurf",
  "zed",
  "subl",
  "idea",
  "webstorm",
);

// Detection is environment-first (ADR-0017 Amendments). The failure it exists
// to fix: a Cursor user launching Scholia from Cursor's integrated terminal
// used to get VS Code, because `code` was found on PATH first.
describe("resolveEditor: the invoking environment (step 1)", () => {
  test("plain VS Code resolves to code", async ({ tmp }) => {
    const editor = await resolveEditor({
      rootDir: tmp.root,
      env: {
        TERM_PROGRAM: "vscode",
        VSCODE_GIT_ASKPASS_NODE:
          "/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)",
      },
      commandExists: ALL,
    });
    expect(editor).toEqual({ command: "code", args: [], source: "environment" });
  });

  test("discriminates Cursor from VS Code despite TERM_PROGRAM=vscode", async ({ tmp }) => {
    const editor = await resolveEditor({
      rootDir: tmp.root,
      env: {
        TERM_PROGRAM: "vscode",
        VSCODE_GIT_ASKPASS_NODE:
          "/Applications/Cursor.app/Contents/Frameworks/Cursor Helper (Plugin).app/Contents/MacOS/Cursor Helper (Plugin)",
      },
      commandExists: ALL,
    });
    expect(editor).toEqual({ command: "cursor", args: [], source: "environment" });
  });

  test("discriminates Windsurf from VS Code despite TERM_PROGRAM=vscode", async ({ tmp }) => {
    const editor = await resolveEditor({
      rootDir: tmp.root,
      env: { TERM_PROGRAM: "vscode", VSCODE_GIT_ASKPASS_NODE: "/opt/Windsurf/windsurf" },
      commandExists: ALL,
    });
    expect(editor).toEqual({ command: "windsurf", args: [], source: "environment" });
  });

  test("discriminates VSCodium from VS Code", async ({ tmp }) => {
    const editor = await resolveEditor({
      rootDir: tmp.root,
      env: { TERM_PROGRAM: "vscode", VSCODE_GIT_ASKPASS_NODE: "/usr/share/codium/codium" },
      commandExists: ALL,
    });
    expect(editor).toEqual({ command: "codium", args: [], source: "environment" });
  });

  test("discriminates Insiders from stable VS Code", async ({ tmp }) => {
    const editor = await resolveEditor({
      rootDir: tmp.root,
      env: {
        TERM_PROGRAM: "vscode",
        VSCODE_GIT_ASKPASS_NODE:
          "/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Electron",
      },
      commandExists: ALL,
    });
    expect(editor).toEqual({ command: "code-insiders", args: [], source: "environment" });
  });

  test("discriminates Positron from VS Code", async ({ tmp }) => {
    const editor = await resolveEditor({
      rootDir: tmp.root,
      env: { TERM_PROGRAM: "vscode", VSCODE_GIT_ASKPASS_NODE: "/Applications/Positron.app/x" },
      commandExists: installed("positron", "code"),
    });
    expect(editor).toEqual({ command: "positron", args: [], source: "environment" });
  });

  // The fork is read out of the *application* path. The working directory is
  // the user's, and a project that happens to be named after an editor must
  // not decide which editor opens it.
  test("a project directory named after a fork does not decide the fork", async ({ tmp }) => {
    const editor = await resolveEditor({
      rootDir: tmp.root,
      env: {
        TERM_PROGRAM: "vscode",
        VSCODE_CWD: "/Users/dana/src/cursor-notes",
        VSCODE_GIT_ASKPASS_NODE: "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
      },
      commandExists: ALL,
    });
    expect(editor).toEqual({ command: "code", args: [], source: "environment" });
  });

  test("falls back to code when the fork's own binary is not on PATH", async ({ tmp }) => {
    const editor = await resolveEditor({
      rootDir: tmp.root,
      env: { TERM_PROGRAM: "vscode", VSCODE_GIT_ASKPASS_NODE: "/Applications/Cursor.app/x" },
      commandExists: installed("code"),
    });
    expect(editor).toEqual({ command: "code", args: [], source: "environment" });
  });

  test("recognises a VS Code terminal through tmux, which overwrites TERM_PROGRAM", async ({
    tmp,
  }) => {
    const editor = await resolveEditor({
      rootDir: tmp.root,
      env: {
        TERM_PROGRAM: "tmux",
        VSCODE_GIT_ASKPASS_NODE: "/Applications/Cursor.app/Contents/MacOS/Cursor",
      },
      commandExists: ALL,
    });
    expect(editor).toEqual({ command: "cursor", args: [], source: "environment" });
  });

  test("resolves Zed from its integrated terminal", async ({ tmp }) => {
    const editor = await resolveEditor({
      rootDir: tmp.root,
      env: { TERM_PROGRAM: "zed", ZED_TERM: "true" },
      commandExists: ALL,
    });
    expect(editor).toEqual({ command: "zed", args: [], source: "environment" });
  });

  // The VSCODE_* vars are inherited by every descendant process, so a terminal
  // that names itself has to outrank them.
  test("a terminal that names itself beats inherited VS Code variables", async ({ tmp }) => {
    const editor = await resolveEditor({
      rootDir: tmp.root,
      env: {
        TERM_PROGRAM: "zed",
        VSCODE_GIT_ASKPASS_NODE: "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
      },
      commandExists: ALL,
    });
    expect(editor).toEqual({ command: "zed", args: [], source: "environment" });
  });

  test("resolves a JetBrains IDE from TERMINAL_EMULATOR", async ({ tmp }) => {
    const editor = await resolveEditor({
      rootDir: tmp.root,
      env: { TERMINAL_EMULATOR: "JetBrains-JediTerm" },
      commandExists: installed("webstorm", "code"),
    });
    expect(editor).toEqual({ command: "webstorm", args: [], source: "environment" });
  });

  test("a plain terminal emulator is not an editor signal", async ({ tmp }) => {
    const editor = await resolveEditor({
      rootDir: tmp.root,
      env: { TERM_PROGRAM: "Apple_Terminal" },
      commandExists: installed("subl"),
    });
    expect(editor).toEqual({ command: "subl", args: [], source: "path" });
  });
});

describe("resolveEditor: repository markers (step 2)", () => {
  test(".zed/ resolves Zed when nothing in the environment says otherwise", async ({ tmp }) => {
    await tmp.write(".zed/settings.json", "{}\n");
    const editor = await resolveEditor({ rootDir: tmp.root, env: {}, commandExists: ALL });
    expect(editor).toEqual({ command: "zed", args: [], source: "repository" });
  });

  test(".idea/ resolves a JetBrains launcher", async ({ tmp }) => {
    await tmp.write(".idea/modules.xml", "<project/>\n");
    const editor = await resolveEditor({
      rootDir: tmp.root,
      env: {},
      commandExists: installed("idea", "code"),
    });
    expect(editor).toEqual({ command: "idea", args: [], source: "repository" });
  });

  test(".vscode/ resolves code", async ({ tmp }) => {
    await tmp.write(".vscode/settings.json", "{}\n");
    const editor = await resolveEditor({ rootDir: tmp.root, env: {}, commandExists: ALL });
    expect(editor).toEqual({ command: "code", args: [], source: "repository" });
  });

  test("a marker for an editor that isn't installed is ignored", async ({ tmp }) => {
    await tmp.write(".vscode/settings.json", "{}\n");
    const editor = await resolveEditor({
      rootDir: tmp.root,
      env: {},
      commandExists: installed("subl"),
    });
    expect(editor).toEqual({ command: "subl", args: [], source: "path" });
  });

  test("the environment beats a committed marker for another editor", async ({ tmp }) => {
    await tmp.write(".vscode/settings.json", "{}\n");
    const editor = await resolveEditor({
      rootDir: tmp.root,
      env: { TERM_PROGRAM: "zed" },
      commandExists: ALL,
    });
    expect(editor).toEqual({ command: "zed", args: [], source: "environment" });
  });
});

describe("resolveEditor: $VISUAL / $EDITOR and the PATH probe (step 3)", () => {
  test("$VISUAL is used when it names a GUI editor", async ({ tmp }) => {
    const editor = await resolveEditor({
      rootDir: tmp.root,
      env: { VISUAL: "code -w" },
      commandExists: ALL,
    });
    expect(editor).toEqual({ command: "code", args: ["-w"], source: "path" });
  });

  test("a terminal $EDITOR is skipped — it cannot be spawned detached", async ({ tmp }) => {
    const editor = await resolveEditor({
      rootDir: tmp.root,
      env: { EDITOR: "/usr/bin/nvim" },
      commandExists: installed("zed"),
    });
    expect(editor).toEqual({ command: "zed", args: [], source: "path" });
  });

  // "Never a broken button" applies here too: a $VISUAL left over from another
  // machine names a binary that isn't installed on this one.
  test("a $VISUAL naming an uninstalled binary is skipped", async ({ tmp }) => {
    const editor = await resolveEditor({
      rootDir: tmp.root,
      env: { VISUAL: "mate -w" },
      commandExists: installed("subl"),
    });
    expect(editor).toEqual({ command: "subl", args: [], source: "path" });
  });

  test("resolves nothing when no editor is installed, so no button is rendered", async ({
    tmp,
  }) => {
    const editor = await resolveEditor({
      rootDir: tmp.root,
      env: { EDITOR: "vim" },
      commandExists: installed(),
    });
    expect(editor).toBeNull();
  });
});

describe("resolveEditor: the --editor override", () => {
  test("wins over an environment that says something else", async ({ tmp }) => {
    const editor = await resolveEditor({
      rootDir: tmp.root,
      override: "subl",
      env: { TERM_PROGRAM: "vscode", VSCODE_GIT_ASKPASS_NODE: "/Applications/Cursor.app/x" },
      commandExists: ALL,
    });
    expect(editor).toEqual({ command: "subl", args: [], source: "override" });
  });

  test("keeps the arguments it was given", async ({ tmp }) => {
    const editor = await resolveEditor({
      rootDir: tmp.root,
      override: "code --reuse-window",
      env: {},
      commandExists: ALL,
    });
    expect(editor).toEqual({ command: "code", args: ["--reuse-window"], source: "override" });
  });

  test("a stale override for an uninstalled editor falls through to detection", async ({ tmp }) => {
    const editor = await resolveEditor({
      rootDir: tmp.root,
      override: "windsurf",
      env: { TERM_PROGRAM: "zed" },
      commandExists: installed("zed"),
    });
    expect(editor).toEqual({ command: "zed", args: [], source: "environment" });
  });
});

describe("openInEditor", () => {
  // The editor is resolved once at startup, so by the time someone clicks the
  // button the binary may be gone. A detached child's 'error' event with no
  // listener is an uncaught exception — it would kill the preview server well
  // after the route had already answered `ok: true`.
  test("a spawn failure does not bring the process down", async ({ tmp }) => {
    const file = await tmp.write("README.md", "# Home\n");
    openInEditor({ command: "scholia-no-such-editor", args: [], source: "path" }, file);
    // The failure arrives asynchronously; an unhandled one fails this run.
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
});

describe("checkEditorOverride", () => {
  test("accepts an installed GUI editor", async () => {
    await expect(checkEditorOverride("cursor", ALL)).resolves.toEqual({
      ok: true,
      editor: { command: "cursor", args: [], source: "override" },
    });
  });

  test("rejects a terminal editor, which cannot be spawned detached", async () => {
    await expect(checkEditorOverride("nvim", ALL)).resolves.toEqual({
      ok: false,
      reason: "terminal-editor",
    });
  });

  test("rejects a binary that is not installed", async () => {
    await expect(checkEditorOverride("mystery-editor", ALL)).resolves.toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  test("accepts an absolute path to a real file", async ({ tmp }) => {
    const bin = await tmp.write("bin/my-editor", "#!/bin/sh\n");
    await expect(checkEditorOverride(bin, installed())).resolves.toEqual({
      ok: true,
      editor: { command: bin, args: [], source: "override" },
    });
  });

  test("rejects a path that does not exist", async ({ tmp }) => {
    await expect(checkEditorOverride(`${tmp.root}/nope`, ALL)).resolves.toEqual({
      ok: false,
      reason: "not-found",
    });
  });
});

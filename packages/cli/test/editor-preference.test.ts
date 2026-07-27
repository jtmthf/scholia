import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, vi } from "vitest";
import { test } from "./helpers/tmp.js";
import { resolveEditorPreference } from "../src/editor-preference.js";

// `os.homedir()` reads $HOME on POSIX and %USERPROFILE% on Windows, so pointing
// both at a temp dir keeps these tests off the developer's real ~/.scholia.
function useTempHome(root: string): void {
  vi.stubEnv("HOME", root);
  vi.stubEnv("USERPROFILE", root);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// An absolute path to a real file passes the "is this editor installed?" check
// without depending on anything being on the test machine's PATH.
async function fakeEditorBinary(tmp: { write: (p: string, c: string) => Promise<string> }) {
  return tmp.write("bin/fake-editor", "#!/bin/sh\n");
}

describe("resolveEditorPreference (ADR-0017)", () => {
  test("persists --editor to ~/.scholia/config and uses it", async ({ tmp }) => {
    useTempHome(tmp.root);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const bin = await fakeEditorBinary(tmp);

    await expect(resolveEditorPreference(bin)).resolves.toBe(bin);

    const saved = JSON.parse(await readFile(join(tmp.root, ".scholia", "config"), "utf8"));
    expect(saved.editor).toBe(bin);
  });

  test("uses the persisted editor on a later run with no flag", async ({ tmp }) => {
    useTempHome(tmp.root);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const bin = await fakeEditorBinary(tmp);

    await resolveEditorPreference(bin);
    await expect(resolveEditorPreference(undefined)).resolves.toBe(bin);
  });

  test("detects (returns undefined) when nothing has been saved", async ({ tmp }) => {
    useTempHome(tmp.root);
    await expect(resolveEditorPreference(undefined)).resolves.toBeUndefined();
  });

  test("rejects an --editor that isn't installed, rather than saving it", async ({ tmp }) => {
    useTempHome(tmp.root);

    await expect(resolveEditorPreference("scholia-no-such-editor")).rejects.toThrow(/not found/);
    await expect(readFile(join(tmp.root, ".scholia", "config"), "utf8")).rejects.toThrow();
  });

  test("rejects a terminal editor, which has no window to open a file in", async ({ tmp }) => {
    useTempHome(tmp.root);
    await expect(resolveEditorPreference("nvim")).rejects.toThrow(/GUI editor/);
  });

  // A stale file is not something the user is doing right now, so it warns and
  // hands over to detection instead of stopping the preview.
  test("warns and falls back to detection when the saved editor is gone", async ({ tmp }) => {
    useTempHome(tmp.root);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await tmp.write(".scholia/config", JSON.stringify({ editor: "scholia-no-such-editor" }));

    await expect(resolveEditorPreference(undefined)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("no longer available");
  });
});

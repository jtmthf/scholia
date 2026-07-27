import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, vi } from "vitest";
import { test } from "./helpers/tmp.js";
import { configPath, loadConfig, saveEditorPreference } from "../src/config.js";

// `os.homedir()` reads $HOME on POSIX and %USERPROFILE% on Windows, so pointing
// both at a temp dir keeps these tests off the developer's real ~/.scholia.
function useTempHome(root: string): void {
  vi.stubEnv("HOME", root);
  vi.stubEnv("USERPROFILE", root);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("~/.scholia/config", () => {
  test("reads back the editor preference it persisted", async ({ tmp }) => {
    useTempHome(tmp.root);
    await saveEditorPreference("cursor");
    await expect(loadConfig()).resolves.toEqual({ editor: "cursor" });
  });

  test("is an empty config when the file does not exist", async ({ tmp }) => {
    useTempHome(tmp.root);
    await expect(loadConfig()).resolves.toEqual({});
  });

  test("is an empty config when the file is unreadable garbage", async ({ tmp }) => {
    useTempHome(tmp.root);
    await tmp.write(".scholia/config", "not json\n");
    await expect(loadConfig()).resolves.toEqual({});
  });

  test("overwrites a previous preference", async ({ tmp }) => {
    useTempHome(tmp.root);
    await saveEditorPreference("code");
    await saveEditorPreference("zed --new");
    await expect(loadConfig()).resolves.toEqual({ editor: "zed --new" });
  });

  test("leaves unrelated keys in the file alone", async ({ tmp }) => {
    useTempHome(tmp.root);
    await tmp.write(".scholia/config", JSON.stringify({ somethingElse: true }));
    await saveEditorPreference("subl");

    const raw = JSON.parse(await readFile(join(tmp.root, ".scholia", "config"), "utf8"));
    expect(raw).toEqual({ somethingElse: true, editor: "subl" });
  });

  test("lives at ~/.scholia/config, beside the credentials store", async ({ tmp }) => {
    useTempHome(tmp.root);
    expect(configPath()).toBe(join(tmp.root, ".scholia", "config"));
  });
});

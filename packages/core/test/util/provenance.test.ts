import { describe, test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProvenance } from "@scholia/core";

describe("getProvenance", () => {
  test("returns undefined for a directory that is not a git repo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scholia-prov-test-"));
    try {
      const result = await getProvenance(dir);
      expect(result).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns undefined for a non-existent directory without throwing", async () => {
    const result = await getProvenance("/tmp/scholia-definitely-does-not-exist-xyz");
    expect(result).toBeUndefined();
  });
});

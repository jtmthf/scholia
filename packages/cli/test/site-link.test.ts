import { expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "./helpers/tmp.js";
import { readSiteLink, writeSiteLink } from "../src/site-link.js";

test("readSiteLink returns null when no marker exists", async ({ tmp }) => {
  expect(await readSiteLink(tmp.root)).toBeNull();
});

test("write then read round-trips the Site link", async ({ tmp }) => {
  await writeSiteLink(tmp.root, {
    slug: "abc123",
    server: "http://localhost:8787",
    shareUrl: "http://localhost:5173/s/abc123",
  });
  const link = await readSiteLink(tmp.root);
  expect(link).toEqual({
    slug: "abc123",
    server: "http://localhost:8787",
    shareUrl: "http://localhost:5173/s/abc123",
  });
  // Marker is written as pretty JSON at `.collab`.
  const raw = await readFile(join(tmp.root, ".collab"), "utf8");
  expect(JSON.parse(raw).slug).toBe("abc123");
});

test("readSiteLink tolerates malformed marker content", async ({ tmp }) => {
  await tmp.write(".collab", "not json");
  expect(await readSiteLink(tmp.root)).toBeNull();
});

test("readSiteLink requires slug + server fields", async ({ tmp }) => {
  await tmp.write(".collab", JSON.stringify({ slug: "x" }));
  expect(await readSiteLink(tmp.root)).toBeNull();
});

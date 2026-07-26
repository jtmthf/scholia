import { expect, test } from "@playwright/test";
import { FIXTURE_SITE } from "../helpers/env.js";
import { runShare } from "../helpers/share.js";
import { zipFixture } from "../helpers/zip.js";

// The CLI auto-detects a .zip archive and unpacks it in memory — the resulting
// Site should be indistinguishable from sharing the same folder.
test("shares a .zip archive and renders the Entry Page", async ({ page }) => {
  const zipPath = await zipFixture(FIXTURE_SITE);
  const site = await runShare(zipPath);

  expect(site.entryPath).toBe("README.md");

  await page.goto(`/s/${site.slug}`);
  await expect(page.frameLocator("iframe.content").locator("h1")).toHaveText("Welcome to Scholia");
  await expect(page.locator("nav.nav").getByRole("link", { name: "Intro" })).toBeVisible();
});

import { expect, test } from "@playwright/test";

test("shows the not-found view for an unknown slug", async ({ page }) => {
  await page.goto("/s/does-not-exist-9f3a2b");
  await expect(page.locator(".centered h1")).toHaveText("Not found");
});

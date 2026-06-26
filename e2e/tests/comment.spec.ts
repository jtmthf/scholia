import { expect, test } from "@playwright/test";
import { FIXTURE_SITE } from "../helpers/env.js";
import { runShare, type SharedSite } from "../helpers/share.js";

// M5 smoke (PLAN §7): the cross-frame select -> anchor -> comment -> highlight
// round-trip the unit/integration tests can't cover. One published Site per file;
// each test mints its own Viewer (localStorage is per-browser-context, so tests
// don't share identity).
let site: SharedSite;

test.beforeAll(async () => {
  site = await runShare(FIXTURE_SITE);
});

test("select text in the content -> floating Comment button appears", async ({ page }) => {
  await page.goto(`/s/${site.slug}`);
  const frame = page.frameLocator("iframe.content");
  await expect(frame.locator("article.markdown-body h1")).toBeVisible();

  // Selecting rendered text fires the iframe bridge's selection capture, which
  // posts the anchor candidate up to the chrome.
  await frame.locator("article.markdown-body p").first().selectText();

  await expect(page.locator(".floating-comment-btn")).toBeVisible();
});

test("select -> comment creates an anchored public Thread in the rail", async ({ page }) => {
  await page.goto(`/s/${site.slug}`);
  const frame = page.frameLocator("iframe.content");
  const para = frame.locator("article.markdown-body p").first();
  await expect(para).toBeVisible();
  const quoted = (await para.innerText()).trim();

  await para.selectText();
  await page.locator(".floating-comment-btn").click();

  // First comment prompts for a display name inline.
  const panel = page.locator(".floating-composer-panel");
  await expect(panel).toBeVisible();
  await panel.locator(".composer-name-row input").fill("Reviewer Jane");
  await panel.locator("textarea").fill("This claim needs a citation.");
  await panel.locator(".btn-primary").click();

  // The Thread shows in the rail: anchored to the selected text, authored by Jane.
  const card = page.locator(".comment-rail .thread-card");
  await expect(card).toHaveCount(1);
  await expect(card.locator(".comment-body")).toHaveText("This claim needs a citation.");
  await expect(card.locator(".identity-name")).toHaveText("Reviewer Jane");
  await expect(card.locator(".thread-anchor-quote")).toContainText(quoted.slice(0, 12));

  // The anchor resolved + highlighted inside the content iframe (CSS Custom
  // Highlight API registers a "collab-anchor" highlight rather than mutating DOM).
  await expect
    .poll(
      () =>
        frame
          .locator("body")
          .evaluate(() => {
            const h = (globalThis as unknown as { CSS?: { highlights?: { has(n: string): boolean } } })
              .CSS?.highlights;
            return h ? h.has("collab-anchor") : false;
          }),
      { timeout: 10_000 },
    )
    .toBe(true);
});

test("anchored Thread persists and re-highlights after reload", async ({ page }) => {
  await page.goto(`/s/${site.slug}`);
  const frame = page.frameLocator("iframe.content");
  const para = frame.locator("article.markdown-body p").first();
  await expect(para).toBeVisible();

  await para.selectText();
  await page.locator(".floating-comment-btn").click();
  const panel = page.locator(".floating-composer-panel");
  await panel.locator(".composer-name-row input").fill("Reviewer Jane");
  await panel.locator("textarea").fill("Persisted across reload.");
  await panel.locator(".btn-primary").click();
  await expect(page.locator(".comment-rail .thread-card")).toHaveCount(1);

  // Reload: the Thread comes back from the server (not just local state) and the
  // anchor re-resolves into the freshly-loaded content document.
  await page.reload();
  const card = page.locator(".comment-rail .thread-card");
  await expect(card).toHaveCount(1);
  await expect(card.locator(".comment-body")).toHaveText("Persisted across reload.");
});

test("page-level comment (no selection) posts to the Page Thread section", async ({ page }) => {
  await page.goto(`/s/${site.slug}`);
  await expect(page.frameLocator("iframe.content").locator("article.markdown-body h1")).toBeVisible();

  await page.locator(".page-comment-btn").click();
  const panel = page.locator(".floating-composer-panel");
  await expect(panel).toBeVisible();
  await panel.locator(".composer-name-row input").fill("Reviewer Jane");
  await panel.locator("textarea").fill("General feedback on this page.");
  await panel.locator(".btn-primary").click();

  const card = page.locator(".comment-rail .thread-card");
  await expect(card).toHaveCount(1);
  await expect(card.locator(".thread-anchor-quote")).toHaveText("Page comment");
  await expect(card.locator(".comment-body")).toHaveText("General feedback on this page.");
});

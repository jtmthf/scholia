import { expect, test } from "@playwright/test";
import { API_URL, FIXTURE_SITE } from "../helpers/env.js";
import { runShare, type SharedSite } from "../helpers/share.js";

// One shared Site for the whole file: `collab share <folder>` runs once, then the
// browser assertions exercise the viewer + content origin against it.
let site: SharedSite;

test.beforeAll(async () => {
  site = await runShare(FIXTURE_SITE);
});

test("publishes via the CLI and resolves the Entry Page", () => {
  expect(site.entryPath).toBe("README.md");
  expect(site.stdout).toContain("published 4 files");
});

test("renders the Entry Page inside the sandboxed iframe", async ({ page }) => {
  await page.goto(`/s/${site.slug}`);

  await expect(page.locator(".chrome .brand")).toHaveText("collab");
  await expect(page.locator(".chrome .version")).toHaveText("v1");
  await expect(page.locator(".chrome .doc-title")).toHaveText("Welcome to Collab");

  const frame = page.frameLocator("iframe.content");
  await expect(frame.locator("article.markdown-body h1")).toHaveText("Welcome to Collab");
});

test("shows the Nav tree and navigates client-side", async ({ page }) => {
  await page.goto(`/s/${site.slug}`);

  const nav = page.locator("nav.nav");
  await expect(nav).toBeVisible();
  // README floats to the top; the guide/ directory holds the two nested Pages.
  await expect(nav.getByRole("link", { name: "Welcome to Collab" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Intro" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Advanced" })).toBeVisible();

  await nav.getByRole("link", { name: "Intro" }).click();

  await expect(page).toHaveURL(new RegExp(`/s/${site.slug}/guide/intro\\.md$`));
  await expect(nav.locator(".nav-link--active")).toHaveText("Intro");
  await expect(page.frameLocator("iframe.content").locator("h1")).toHaveText("Intro");
});

test("rewrites inter-Page links to top-navigate the viewer route", async ({ page }) => {
  await page.goto(`/s/${site.slug}`);

  const frame = page.frameLocator("iframe.content");
  const link = frame.getByRole("link", { name: "Read the intro" });
  // Rewritten at serve time: target=_top so the sandboxed iframe drives the top frame.
  await expect(link).toHaveAttribute("target", "_top");

  await link.click();

  await expect(page).toHaveURL(new RegExp(`/s/${site.slug}/guide/intro\\.md$`));
  // The Collab chrome persists — the top frame is the viewer, not the raw doc.
  await expect(page.locator(".chrome .brand")).toHaveText("collab");
  await expect(frame.locator("h1")).toHaveText("Intro");
});

test("leaves external links untouched", async ({ page }) => {
  await page.goto(`/s/${site.slug}`);
  const ext = page.frameLocator("iframe.content").getByRole("link", { name: "External docs" });
  await expect(ext).toHaveAttribute("href", "https://example.com/docs");
  await expect(ext).not.toHaveAttribute("target", "_top");
});

test("serves Assets and applies content-origin headers", async ({ page, request }) => {
  await page.goto(`/s/${site.slug}`);

  // The relative <img src="logo.svg"> resolves against the content origin and loads.
  const img = page.frameLocator("iframe.content").locator("img");
  await expect(img).toBeVisible();
  const naturalWidth = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
  expect(naturalWidth).toBeGreaterThan(0);

  const meta = (await (await request.get(`${API_URL}/sites/${site.slug}`)).json()) as {
    contentBase: string;
  };

  const asset = await request.get(`${meta.contentBase}/logo.svg`);
  expect(asset.status()).toBe(200);
  expect(asset.headers()["content-type"]).toContain("svg");
  expect(asset.headers()["x-robots-tag"]).toContain("noindex");

  const doc = await request.get(`${meta.contentBase}/README.md`);
  expect(doc.status()).toBe(200);
  expect(doc.headers()["content-type"]).toContain("text/html");
  expect(doc.headers()["x-robots-tag"]).toContain("noindex");
  expect(doc.headers()["referrer-policy"]).toBe("no-referrer");
});

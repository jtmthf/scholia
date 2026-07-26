import { expect, test } from "@playwright/test";
import { API_URL, FIXTURE_HTML_SITE } from "../helpers/env.js";
import { runShare, type SharedSite } from "../helpers/share.js";

// M4: an HTML Page renders in the same sandboxed iframe as Markdown, keeps its
// uploaded JS, and is served with the content-origin CSP. One shared Site for
// the file: `scholia share <html-site>` runs once, then the assertions run.
let site: SharedSite;

test.beforeAll(async () => {
  site = await runShare(FIXTURE_HTML_SITE);
});

test("index.html wins Entry Page precedence (M4)", () => {
  expect(site.entryPath).toBe("index.html");
});

test("renders the HTML Page in the iframe with its uploaded JS running", async ({ page }) => {
  await page.goto(`/s/${site.slug}`);
  const frame = page.frameLocator("iframe.content");

  await expect(frame.locator("h1")).toHaveText("HTML Home");
  // The inline <script> ran (allow-scripts + CSP self/inline).
  await expect(frame.locator("body")).toHaveAttribute("data-hydrated", "1");

  // Interactivity is preserved, not stripped.
  const button = frame.locator("#counter");
  await button.click();
  await expect(button).toHaveText("clicks: 1");
});

test("rewrites an HTML Page's inter-Page link to top-navigate the viewer", async ({ page }) => {
  await page.goto(`/s/${site.slug}`);
  const frame = page.frameLocator("iframe.content");
  const link = frame.getByRole("link", { name: "about page" });
  await expect(link).toHaveAttribute("target", "_top");

  await link.click();
  await expect(page).toHaveURL(new RegExp(`/s/${site.slug}/about\\.md$`));
  await expect(page.locator(".chrome .brand")).toHaveText("scholia");
  await expect(frame.locator("h1")).toHaveText("About");
});

test("serves the HTML Page with CSP + noindex content headers", async ({ request }) => {
  const meta = (await (await request.get(`${API_URL}/sites/${site.slug}`)).json()) as {
    contentBase: string;
  };
  const doc = await request.get(`${meta.contentBase}/index.html`);
  expect(doc.status()).toBe(200);
  expect(doc.headers()["content-type"]).toContain("text/html");
  expect(doc.headers()["x-robots-tag"]).toContain("noindex");
  expect(doc.headers()["referrer-policy"]).toBe("no-referrer");
  expect(doc.headers()["content-security-policy"]).toContain("frame-ancestors");
});

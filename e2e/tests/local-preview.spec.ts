import { expect, test, type Page } from "@playwright/test";
import { startLocalPreview, type LocalPreview } from "../helpers/local-preview.js";

// Local Preview's chrome — Nav, Outline, breadcrumb, Colophon, search — is
// server-rendered furniture (ADR-0011): finished HTML, no hydration. These tests
// hold that contract from the browser's side, so a change to how the chrome is
// templated has to keep the reading experience identical rather than merely
// looking identical to whoever wrote it.
//
// Unlike the rest of this suite, nothing here touches the API, the content
// origin or the viewer: Local Preview reaches no network, DB or token.

// Enough body that each section fills more than a viewport — the Outline
// scrollspy only has anything to say about a document that actually scrolls.
function filler(label: string): string {
  return Array.from({ length: 25 }, (_, i) => `${label} paragraph ${i + 1}.`).join("\n\n");
}

const SEED = {
  "README.md": "# Home\n\nWelcome to the docs. The magic word is xylophone.\n",
  "guide/intro.md": [
    "# Intro",
    "",
    "Nested body text.",
    "",
    "## Section One",
    "",
    filler("One"),
    "",
    "### Sub A",
    "",
    filler("Sub"),
    "",
    "## Section Two",
    "",
    filler("Two"),
    "",
    "#### Too Deep",
    "",
    "Below the Outline's depth window.",
    "",
    filler("Tail"),
    "",
  ].join("\n"),
  "guide/advanced.md": "# Advanced\n\nAdvanced body text.\n",
  // Owned by the live-reload test, which rewrites it. It ships with a `##` so
  // the Outline is already on the page: live reload replaces the regions it
  // finds, and one that isn't rendered yet has nothing to replace.
  "live.md": "# Live\n\nOriginal body text.\n\n## Original Section\n\nSection body.\n",
};

let preview: LocalPreview;

// The suite runs fully parallel, so each worker gets its own preview over its
// own temp root — the live-reload tests edit files under it and must not see
// each other's writes. The port band is per-worker for the same reason.
const PORT_BASE = 4310;

test.beforeAll(async () => {
  const worker = Number(process.env.TEST_PARALLEL_INDEX ?? 0);
  preview = await startLocalPreview({ seed: SEED, port: PORT_BASE + worker });
});

test.afterAll(async () => {
  await preview?.stop();
});

test.describe("server-rendered chrome", () => {
  // The point of SSR here: the whole reading experience is in the first
  // response. With JS switched off entirely, every piece of chrome still has to
  // be present and correct — that is what "no hydration for static content"
  // means, and it is not observable any other way.
  test.use({ javaScriptEnabled: false });

  test("renders the whole reading view with JavaScript disabled", async ({ page }) => {
    await page.goto(`${preview.url}/guide/intro.md`);

    await expect(page).toHaveTitle("Intro");
    await expect(page.locator(".page-title")).toHaveText("Intro");
    await expect(page.locator("article.markdown-body")).toContainText("Nested body text.");

    // Nav: the served root's tree, with the current Page marked active.
    const nav = page.locator("nav.nav");
    await expect(nav.getByRole("link", { name: "Home" })).toBeVisible();
    await expect(nav.locator(".nav-dir-label")).toHaveText("Guide");
    await expect(nav.locator("a.active .nav-label")).toHaveText("Intro");

    // Outline: h2/h3 only — the h4 is outside the window it shows.
    const outline = page.locator("nav.outline");
    await expect(outline.locator(".outline-title")).toHaveText("Outline");
    await expect(outline.locator("li")).toHaveText(["Section One", "Sub A", "Section Two"]);
    await expect(outline.locator("li.outline-h2")).toHaveCount(2);
    await expect(outline.locator("li.outline-h3")).toHaveCount(1);

    // Breadcrumb: directory segments link to their Entry Page, the current Page
    // is plain text.
    const breadcrumb = page.locator("nav.breadcrumb");
    await expect(breadcrumb.getByRole("link", { name: "guide" })).toHaveAttribute(
      "href",
      "/guide/",
    );
    await expect(breadcrumb.locator(".crumb-current")).toHaveText("intro");

    // Colophon: path and mtime, after the article rather than above it.
    const colophon = page.locator("footer.colophon");
    await expect(colophon.locator(".colophon-path")).toHaveText("guide/intro.md");
    await expect(colophon.locator(".colophon-mtime")).toContainText("edited");

    // Page actions: "Copy markdown" always, plus one primary action whose
    // identity depends on whether an editor resolved on this machine (ADR-0017).
    await expect(page.locator(".page-actions .btn")).toHaveCount(2);
    await expect(page.locator("#scholia-copy-md")).toHaveText("Copy markdown");
    await expect(page.locator("#scholia-open-editor, #scholia-copy-path")).toHaveCount(1);

    // The search shell ships with the page; only its results need JS.
    await expect(page.locator("#scholia-search")).toHaveAttribute("type", "search");
    await expect(page.locator("#scholia-search-results")).toBeHidden();
  });

  test("nav links navigate without JavaScript", async ({ page }) => {
    await page.goto(`${preview.url}/`);
    await page.locator("nav.nav").getByRole("link", { name: "Advanced" }).click();

    await expect(page).toHaveURL(`${preview.url}/guide/advanced.md`);
    await expect(page.locator("article.markdown-body")).toContainText("Advanced body text.");
  });

  // `/` resolves to the root's Entry Page (CONTEXT "Entry Page"), and the
  // breadcrumb is derived from the resolved Page's path — so at the root it is
  // the Page's own name with nothing above it to link to.
  test("the Site root renders its Entry Page", async ({ page }) => {
    await page.goto(`${preview.url}/`);

    await expect(page).toHaveTitle("Home");
    await expect(page.locator("article.markdown-body")).toContainText("Welcome to the docs.");
    await expect(page.locator("nav.breadcrumb .crumb-current")).toHaveText("README");
    await expect(page.locator("nav.breadcrumb a")).toHaveCount(0);
    // A single top-level Page has no h2/h3, so there is no Outline to show.
    await expect(page.locator("nav.outline")).toHaveCount(0);
  });
});

test("search queries the server index and links to the hit", async ({ page }) => {
  await page.goto(`${preview.url}/`);

  await page.locator("#scholia-search").fill("xylophone");
  const results = page.locator("#scholia-search-results");
  await expect(results.locator("a")).toHaveCount(1);
  await expect(results.locator("mark")).toHaveText("xylophone");

  await results.locator("a").first().click();
  await expect(page.locator("article.markdown-body")).toContainText("Welcome to the docs.");
});

test("the theme toggle flips the color scheme and remembers it", async ({ page }) => {
  await page.goto(`${preview.url}/`);
  const html = page.locator("html");
  const wasDark = await html.evaluate((el) => el.classList.contains("dark"));

  await page.locator("#scholia-theme-toggle").click();
  await expect(html).toHaveClass(wasDark ? /^(?!.*\bdark\b)/ : /\bdark\b/);

  // The pre-paint script reads this back before first paint, so the choice has
  // to survive a reload without a flash of the other scheme.
  await page.reload();
  await expect(html).toHaveClass(wasDark ? /^(?!.*\bdark\b)/ : /\bdark\b/);
});

// The scrollspy watches a band near the top of the viewport, not the whole of
// it, so "in view" here means parked inside that band — an anchor jump that
// lands a heading flush against y=0 is above it and deliberately reads as
// nothing in view.
async function parkHeadingInSpyBand(page: Page, id: string): Promise<void> {
  await page.evaluate((headingId) => {
    const heading = document.getElementById(headingId);
    if (!heading) throw new Error(`no heading #${headingId}`);
    window.scrollTo({ top: heading.getBoundingClientRect().top + window.scrollY - 150 });
  }, id);
}

test("the Outline scrollspy follows the section in view", async ({ page }) => {
  await page.goto(`${preview.url}/guide/intro.md`);

  await parkHeadingInSpyBand(page, "section-two");
  await expect(page.locator(".outline a.active")).toHaveText("Section Two");

  await parkHeadingInSpyBand(page, "section-one");
  await expect(page.locator(".outline a.active")).toHaveText("Section One");
});

// Live reload swaps the article in place rather than reloading the document, so
// the reader keeps their scroll position (and, here, anything else on `window`).
// A marker set before the edit surviving it is the proof that no navigation
// happened; a full reload would wipe it.
test("live reload swaps content in place without navigating", async ({ page }) => {
  await page.goto(`${preview.url}/live.md`);
  await expect(page.locator("article.markdown-body")).toContainText("Original body text.");

  await page.evaluate(() => {
    (window as unknown as { __liveReloadMarker?: number }).__liveReloadMarker = 42;
  });

  await preview.write("live.md", "# Live\n\nEdited body text.\n\n## New Section\n\nBody.\n");

  await expect(page.locator("article.markdown-body")).toContainText("Edited body text.");
  await expect(page.locator("article.markdown-body")).not.toContainText("Original body text.");
  // The Outline is one of the regions swapped alongside the article.
  await expect(page.locator(".outline li")).toHaveText(["New Section"]);

  const marker = await page.evaluate(
    () => (window as unknown as { __liveReloadMarker?: number }).__liveReloadMarker,
  );
  expect(marker).toBe(42);
});

// Adding a Page is a structural change: the server rescans and the Nav pane —
// not just the article — has to come back updated.
test("live reload picks up a new Page in the Nav", async ({ page }) => {
  await page.goto(`${preview.url}/`);
  const nav = page.locator("nav.nav");
  await expect(nav.getByRole("link", { name: "Appendix" })).toHaveCount(0);

  await preview.write("guide/appendix.md", "# Appendix\n\nAdded while the preview was running.\n");

  await expect(nav.getByRole("link", { name: "Appendix" })).toBeVisible();
});

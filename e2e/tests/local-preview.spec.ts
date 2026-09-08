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
  "guide/deep/deeper.md": "# Deeper\n\nDeep body text.\n",
  "reference/intro.md": "# Reference\n\nReference body text.\n",
  // Owned by the live-reload test, which rewrites it. It ships with a `##` so
  // the Outline is already on the page: live reload replaces the regions it
  // finds, and one that isn't rendered yet has nothing to replace.
  "live.md": "# Live\n\nOriginal body text.\n\n## Original Section\n\nSection body.\n",
  // Owned by the ADR-0039 describe block (issue #159). Has a heading so the
  // Outline is in play, and the block's `beforeAll` seeds a page-level
  // Conversation to bring the Rail's column in.
  "layout.md": "# Layout\n\nA Page measured at narrow widths.\n\n## Section\n\nBody.\n",
  // Owned by the zero-to-one live-reload test (issue #158): starts with
  // nothing to comment on.
  "zero-to-one.md": "# Zero To One\n\nNothing has been said about this yet.\n",
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
    await expect(nav.locator(".nav-dir-link").filter({ hasText: "Guide" })).toHaveText("Guide");
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

  test("directory labels navigate to their Entry Pages without JavaScript", async ({ page }) => {
    await page.goto(`${preview.url}/`);
    await page.locator("nav.nav").getByRole("link", { name: "Guide", exact: true }).click();

    await expect(page).toHaveURL(`${preview.url}/guide`);
    await expect(page.locator("article.markdown-body")).toContainText("Advanced body text.");
  });

  test("directory rows disclose with the keyboard and open only current Page ancestors", async ({
    page,
  }) => {
    const nav = page.locator("nav.nav");
    const directory = (path: string) =>
      nav.locator(`details.nav-dir:has(> summary > a.nav-dir-link[href="${path}"])`);

    await page.goto(`${preview.url}/`);
    const guide = directory("/guide");
    await expect(guide).not.toHaveAttribute("open", "");

    const guideSummary = guide.locator(":scope > summary");
    await expect(guideSummary).toHaveAccessibleName("Toggle Guide");
    await guideSummary.focus();
    await page.keyboard.press("Space");
    await expect(guide).toHaveAttribute("open", "");
    await expect(guide.getByRole("link", { name: "Advanced" })).toBeVisible();

    await page.goto(`${preview.url}/guide/deep/deeper.md`);
    await expect(directory("/guide")).toHaveAttribute("open", "");
    await expect(directory("/guide/deep")).toHaveAttribute("open", "");
    await expect(directory("/reference")).not.toHaveAttribute("open", "");
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

test.describe("ADR-0039: the Rail takes the Outline's track (issue #159)", () => {
  // The four/three/two-column grids only appear when the Page has a
  // Conversation (`body.has-conversations`, issue #158) — seed a page-level
  // Comment so layout.md renders the full arrangement.
  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${preview.url}/__conversations`, {
      headers: { "Sec-Fetch-Site": "same-origin" },
      data: { page: "layout.md", body: "A note on the layout." },
    });
    expect(res.status()).toBe(200);
  });

  // Split a computed `grid-template-columns` (e.g. "260px 780px 220px 320px")
  // into its tracks, so the arrangement is verified from what the grid
  // actually computed rather than from the source that produced it.
  async function trackCount(page: Page): Promise<number> {
    const value = await page
      .locator(".layout")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    return value.trim().split(/\s+/).filter(Boolean).length;
  }

  test("the arrangement at every width matches the ADR-0039 table, verified from computed grid tracks", async ({
    page,
  }) => {
    await page.goto(`${preview.url}/layout.md`);
    const outline = page.locator("nav.outline");
    const rail = page.locator("#scholia-comments");
    const menuToggle = page.locator(".menu-toggle");

    // >= 1748: Nav + sheet + Outline + Rail — four tracks.
    await page.setViewportSize({ width: 1800, height: 900 });
    expect(await trackCount(page)).toBe(4);
    await expect(outline).toBeVisible();
    await expect(menuToggle).toBeHidden();

    // 1440 - 1748: Nav + sheet + Rail — Outline yields first.
    await page.setViewportSize({ width: 1600, height: 900 });
    expect(await trackCount(page)).toBe(3);
    await expect(outline).toBeHidden();
    await expect(menuToggle).toBeHidden();

    // 1188 - 1440: sheet + Rail — Nav yields next, but stays reachable
    // behind the same toggle narrow viewports already use.
    await page.setViewportSize({ width: 1300, height: 900 });
    expect(await trackCount(page)).toBe(2);
    await expect(outline).toBeHidden();
    await expect(menuToggle).toBeVisible();

    // < 1188: the Rail leaves the column — one track, and the rail's own box
    // is no longer the sticky scroll container.
    await page.setViewportSize({ width: 1000, height: 900 });
    expect(await trackCount(page)).toBe(1);
    await expect(rail).toBeVisible();
    expect(await rail.evaluate((el) => getComputedStyle(el).position)).toBe("static");

    // < 720: existing mobile behaviour, unchanged — still one track, the
    // toggle still reaches Nav, and the rail is still there to read.
    await page.setViewportSize({ width: 480, height: 900 });
    expect(await trackCount(page)).toBe(1);
    await expect(menuToggle).toBeVisible();
    await expect(rail).toBeVisible();
  });

  // The promise, not the breakpoint numbers (CLAUDE.md, ADR-0039): asserted
  // just above and below every threshold in the table, plus a representative
  // width inside each band, so a token change that moves a number is free to
  // move this test's numbers with it and still be caught if it breaks the
  // promise itself.
  test("the reading measure never breaks, above the mobile breakpoint", async ({ page }) => {
    await page.goto(`${preview.url}/layout.md`);
    const article = page.locator("article.markdown-body");

    const widths = [
      1920, 1749, 1748, 1747, 1600, 1489, 1488, 1487, 1441, 1440, 1439, 1300, 1189, 1188, 1187,
      1000, 828, 780,
    ];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      const box = await article.boundingBox();
      expect(box, `width ${width}`).not.toBeNull();
      expect(box!.width, `width ${width}`).toBeGreaterThanOrEqual(778);

      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, `width ${width}`).toBeLessThanOrEqual(width);
    }
  });

  test("the Rail is never clipped mid-word", async ({ page }) => {
    await page.goto(`${preview.url}/layout.md`);
    for (const width of [1800, 1600, 1300]) {
      await page.setViewportSize({ width, height: 900 });
      const box = await page.locator(".comment-rail").boundingBox();
      expect(box, `width ${width}`).not.toBeNull();
      expect(box!.width, `width ${width}`).toBeGreaterThanOrEqual(318);
    }
  });

  test("a pane taken away by a width change comes back on its own, without the reader re-asking", async ({
    page,
  }) => {
    await page.goto(`${preview.url}/layout.md`);
    const outline = page.locator("nav.outline");

    await page.setViewportSize({ width: 1800, height: 900 });
    await expect(outline).toBeVisible();

    await page.setViewportSize({ width: 1600, height: 900 });
    await expect(outline).toBeHidden();

    await page.setViewportSize({ width: 1800, height: 900 });
    await expect(outline).toBeVisible();
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

// Issue #114: one glyph and one label in both themes told the reader nothing
// about which theme was on. The name comes from whichever face CSS is showing,
// so asserting it is asserting that exactly one face is visible.
test("the theme toggle names the theme it is in, and says so to assistive tech", async ({
  page,
}) => {
  await page.goto(`${preview.url}/`);
  const toggle = page.locator("#scholia-theme-toggle");
  const startedDark = await page.locator("html").evaluate((el) => el.classList.contains("dark"));

  await expect(toggle).toHaveAccessibleName(startedDark ? "Dark theme" : "Light theme");
  await expect(toggle).toHaveAttribute("aria-pressed", startedDark ? "true" : "false");

  await toggle.click();
  await expect(toggle).toHaveAccessibleName(startedDark ? "Light theme" : "Dark theme");
  await expect(toggle).toHaveAttribute("aria-pressed", startedDark ? "false" : "true");
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

// `body.has-conversations` (ADR-0039, issue #158) is exactly the class the
// swap loop's named-element replacement doesn't reach — `<body>` is never one
// of the elements it swaps — so this is the one class main.ts syncs by hand.
// An agent commenting on a Page nobody else has touched (the Sidecar's own
// files live under the watched tree, so this is a live-reload notification
// like any other) has to see the Rail's column arrive with no manual reload.
test("an agent's first Comment on an open, un-commented Page brings the Rail's column in over live reload", async ({
  page,
  request,
}) => {
  await page.goto(`${preview.url}/zero-to-one.md`);
  await expect(page.locator("#scholia-comments")).toBeVisible();
  expect(await page.evaluate(() => document.body.classList.contains("has-conversations"))).toBe(
    false,
  );

  const res = await request.post(`${preview.url}/__conversations`, {
    headers: { "Sec-Fetch-Site": "same-origin" },
    data: { page: "zero-to-one.md", body: "First word on this Page." },
  });
  expect(res.status()).toBe(200);

  await expect(page.locator(".thread-card")).toContainText("First word on this Page.");
  expect(await page.evaluate(() => document.body.classList.contains("has-conversations"))).toBe(
    true,
  );
});

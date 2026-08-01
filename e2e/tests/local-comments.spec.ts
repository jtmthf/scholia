import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { startLocalPreview, type LocalPreview } from "../helpers/local-preview.js";

// The tracer bullet (issue #28): select text in Local Preview, write a comment,
// and it persists beside your content — anchored to what you highlighted, and
// still there when you reload.
//
// This is the only place the whole path runs end to end. The selection is a real
// browser selection over rendered DOM, the Anchor is built from it, the Sidecar
// is a real directory in a real temp tree, and the reload is a real reload. Like
// the rest of the Local Preview suite it touches no network, DB or token.
//
// Every test owns its own Page, because the Sidecar is shared state within a
// worker and a Conversation left by one test must not appear in another's rail.

const SEED = {
  "README.md": "# Home\n\nWelcome to the docs.\n",
  "anchor.md": "# Anchor\n\nThe anchor is the moat, and it works locally.\n",
  "page-level.md": "# Page Level\n\nNothing here needs highlighting.\n",
  "repeated.md": [
    "# Repeated",
    "",
    "See below for details.",
    "",
    "Filler between the two.",
    "",
    "See below for details.",
    "",
  ].join("\n"),
  "reply.md": "# Reply\n\nReply target.\n",
  "gone.md": "# Gone\n\nThis Page says nothing the seeded Anchor quotes.\n",
  "server-rendered.md": "# Server Rendered\n\nReadable with JavaScript off.\n",
  "capabilities.md": "# Capabilities\n\nOnly what the Sidecar can do.\n",
  // An HTML Page, to prove the comment layer is not a Markdown-only feature.
  "hand.html": [
    "<!doctype html>",
    "<html>",
    "  <head><title>Hand Written</title></head>",
    "  <body>",
    "    <h1>Hand Written</h1>",
    "    <p>Authored as HTML, commented on the same way.</p>",
    "  </body>",
    "</html>",
    "",
  ].join("\n"),
};

let preview: LocalPreview;

// Own preview, own temp root, own port band per worker — the Sidecar is a
// directory these tests write into, so they must not see each other's writes.
const PORT_BASE = 4360;

test.beforeAll(async () => {
  const worker = Number(process.env.TEST_PARALLEL_INDEX ?? 0);
  preview = await startLocalPreview({ seed: SEED, port: PORT_BASE + worker });
});

test.afterAll(async () => {
  await preview?.stop();
});

interface StoredConversation {
  id: string;
  anchor: { textQuote: { exact: string; prefix?: string; suffix?: string } } | null;
  comments: Array<{ body: string }>;
}

/** What the Sidecar holds for a Page, read back over the same route the client uses. */
async function stored(request: APIRequestContext, page: string): Promise<StoredConversation[]> {
  const res = await request.get(`${preview.url}/__conversations?page=${encodeURIComponent(page)}`);
  return ((await res.json()) as { conversations: StoredConversation[] }).conversations;
}

/** Seed a Conversation without a browser, for tests about *reading* one. */
async function seedComment(
  request: APIRequestContext,
  page: string,
  body: string,
  exact?: string,
): Promise<void> {
  const res = await request.post(`${preview.url}/__conversations`, {
    headers: { "Sec-Fetch-Site": "same-origin" },
    data: { page, body, ...(exact ? { selection: { quote: { exact } } } : {}) },
  });
  expect(res.status()).toBe(200);
}

/** Select `text` inside the rendered content, the way a reader drags across it. */
async function selectInContent(page: Page, text: string, occurrence = 0): Promise<void> {
  await page.evaluate(
    ({ needle, nth }) => {
      const content = document.querySelector("article.markdown-body");
      if (!content) throw new Error("no content element");

      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      let seen = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const value = node.nodeValue ?? "";
        let from = value.indexOf(needle);
        while (from !== -1) {
          if (seen++ === nth) {
            const range = document.createRange();
            range.setStart(node, from);
            range.setEnd(node, from + needle.length);
            const selection = window.getSelection()!;
            selection.removeAllRanges();
            selection.addRange(range);
            document.dispatchEvent(new Event("selectionchange"));
            return;
          }
          from = value.indexOf(needle, from + needle.length);
        }
      }
      throw new Error(`no occurrence ${nth} of ${JSON.stringify(needle)} in the content`);
    },
    { needle: text, nth: occurrence },
  );
}

/**
 * How many Anchors are actually painted in the content right now.
 *
 * Read from the CSS Custom Highlight registry, which is where `AnchorHighlights`
 * puts them — the only evidence that a stored quote *re-resolved* against the
 * rendered text rather than merely being displayed in the rail from what was
 * saved. Chromium is the only project this suite runs, and it has the API.
 */
function paintedAnchors(page: Page): Promise<number> {
  return page.evaluate(() => {
    const registry = (CSS as unknown as { highlights?: Map<string, { size: number }> }).highlights;
    return registry?.get("scholia-anchor")?.size ?? 0;
  });
}

/** The viewport centre of the first occurrence of `text` in the content. */
function centreOf(page: Page, text: string): Promise<{ x: number; y: number }> {
  return page.evaluate((needle) => {
    const content = document.querySelector("article.markdown-body")!;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const from = (node.nodeValue ?? "").indexOf(needle);
      if (from === -1) continue;
      const range = document.createRange();
      range.setStart(node, from);
      range.setEnd(node, from + needle.length);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    throw new Error(`no ${JSON.stringify(needle)} in the content`);
  }, text);
}

/** Select `text`, click Comment, write `body`, submit — and wait for the card. */
async function commentOnSelection(
  page: Page,
  text: string,
  body: string,
  occurrence = 0,
): Promise<void> {
  await selectInContent(page, text, occurrence);
  await page.locator("#scholia-comment-selection").click();
  await page.locator(".floating-composer-panel textarea").fill(body);
  await page.locator(".floating-composer-panel button[type=submit]").click();
  await expect(page.locator(".comment-rail")).toContainText(body);
}

test("select text, comment, reload — the Conversation is still anchored", async ({ page }) => {
  await page.goto(`${preview.url}/anchor.md`);

  // Nothing said yet.
  await expect(page.locator(".rail-empty")).toBeVisible();

  await commentOnSelection(page, "the moat", "Is this still the differentiator?");

  const card = page.locator(".thread-card");
  await expect(card).toHaveCount(1);
  await expect(card.locator(".thread-anchor-quote")).toHaveText("“the moat”");

  // The whole point: it is on disk, not in memory. A reload re-reads the
  // Sidecar and re-resolves the Anchor against the freshly rendered text.
  await page.reload();

  await expect(page.locator(".thread-card")).toHaveCount(1);
  await expect(page.locator(".thread-anchor-quote")).toHaveText("“the moat”");
  await expect(page.locator(".comment-rail")).toContainText("Is this still the differentiator?");
  await expect(page.locator(".rail-section-title").first()).toHaveText("Anchored (1)");

  // "Still anchored" is a claim about the content, not about the rail: the rail
  // would say exactly this even if resolution had failed for every Conversation.
  // The painted highlight is what proves the stored quote found its passage again.
  await expect.poll(() => paintedAnchors(page)).toBe(1);

  // And the two are connected: clicking the passage focuses the card that is
  // about it (the local equivalent of the bridge's `anchor-activated`).
  const at = await centreOf(page, "the moat");
  await page.mouse.click(at.x, at.y);
  await expect(page.locator(".thread-card--active")).toHaveCount(1);
});

// An Anchor whose quote is no longer in the Page can't be painted. It must still
// render — with its original quote, which is what an Outdated Conversation is
// for (CONTEXT "Outdated") — rather than vanish. Showing it *as* Outdated is
// issue #30; not losing it is this ticket's job.
test("a Conversation whose passage is gone still renders, unpainted", async ({ page, request }) => {
  await seedComment(request, "gone.md", "About text that no longer exists.", "a passage long gone");
  await page.goto(`${preview.url}/gone.md`);

  await expect(page.locator(".thread-card")).toHaveCount(1);
  await expect(page.locator(".thread-anchor-quote")).toHaveText("“a passage long gone”");
  await expect.poll(() => paintedAnchors(page)).toBe(0);
});

// ADR-0011: the rail is server-rendered chrome. With JavaScript off entirely
// there is no selecting and no composing, but every Conversation on the Page is
// still readable — which is what "only the comment layer hydrates" has to mean.
test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("Conversations are in the first response", async ({ page, request }) => {
    await seedComment(
      request,
      "server-rendered.md",
      "Readable before any JS runs.",
      "JavaScript off",
    );
    await page.goto(`${preview.url}/server-rendered.md`);

    await expect(page.locator(".comment-rail")).toBeVisible();
    await expect(page.locator(".comment-rail")).toContainText("Readable before any JS runs.");
    await expect(page.locator(".thread-anchor-quote")).toHaveText("“JavaScript off”");
  });
});

// CONTEXT "Anchor": an Anchor must ground to something unique, with context
// expanded at creation until the quote identifies one target and no other. The
// seeded Page says "See below for details." twice on purpose.
test("a repeated phrase anchors to the occurrence that was selected", async ({ page, request }) => {
  await page.goto(`${preview.url}/repeated.md`);

  await commentOnSelection(page, "See below", "The second one.", 1);

  // Uniqueness lives in the stored context, not in an occurrence ordinal.
  const conversations = await stored(request, "repeated.md");
  const anchor = conversations.find((c) =>
    c.comments.some((m) => m.body === "The second one."),
  )!.anchor!;
  expect(anchor.textQuote.exact).toBe("See below");
  // The prefix reaches back past the filler to what makes this the second one.
  expect(anchor.textQuote.prefix ?? "").toContain("Filler between");
});

test("a Page-level comment needs no selection and shows in its own section", async ({ page }) => {
  await page.goto(`${preview.url}/page-level.md`);

  await page.locator(".page-comment-btn").click();
  await page.locator(".floating-composer-panel textarea").fill("About this page as a whole.");
  await page.locator(".floating-composer-panel button[type=submit]").click();

  await expect(page.locator(".rail-section-title")).toHaveText("Page comments (1)");
  await expect(page.locator(".thread-anchor-quote")).toHaveText("Page comment");

  await page.reload();
  await expect(page.locator(".comment-rail")).toContainText("About this page as a whole.");
});

// AC: works for both Markdown and HTML Pages. An HTML Page renders inside the
// chrome and anchors against its rendered text the same way.
test("an HTML Page takes an anchored comment too", async ({ page }) => {
  await page.goto(`${preview.url}/hand.html`);

  await expect(page).toHaveTitle("Hand Written");
  await expect(page.locator("article.markdown-body h1")).toHaveText("Hand Written");

  await commentOnSelection(page, "Authored as HTML", "Same layer, other Page kind.");

  await page.reload();
  await expect(page.locator(".thread-anchor-quote")).toHaveText("“Authored as HTML”");
});

// A reply is an append to the same Conversation, not a second Conversation
// (ADR-0019) — the file is the agent-facing artifact and a thread is one read.
test("a reply lands in the Conversation it answers", async ({ page }) => {
  await page.goto(`${preview.url}/reply.md`);

  await commentOnSelection(page, "Reply target", "First word.");

  await page.locator(".thread-action-btn", { hasText: "Reply" }).click();
  await page.locator(".thread-card textarea").fill("Second word.");
  await page.locator(".thread-card button[type=submit]").click();

  await expect(page.locator(".thread-card")).toHaveCount(1);
  await expect(page.locator(".thread-card .comment")).toHaveCount(2);

  await page.reload();
  await expect(page.locator(".thread-card .comment")).toHaveCount(2);
  await expect(page.locator(".thread-card")).toContainText("Second word.");
});

// Local Preview's Sidecar can only write `comment` events so far (ADR-0019,
// issue #32), and @scholia/ui renders an absent port method as an affordance
// this surface doesn't have — not one that fails when clicked (ADR-0030).
test("offers only what the Sidecar can actually do", async ({ page, request }) => {
  await seedComment(request, "capabilities.md", "Something to act on.");
  await page.goto(`${preview.url}/capabilities.md`);

  const card = page.locator(".thread-card").first();
  await expect(card.locator(".thread-action-btn", { hasText: "Reply" })).toBeVisible();
  await expect(card.locator(".thread-action-btn--resolve")).toHaveCount(0);
  await expect(card.locator(".thread-action-btn--delete")).toHaveCount(0);
  await expect(card.locator(".reaction-chip")).toHaveCount(0);
  // No tokens to hand out locally, so no "Bring your agent".
  await expect(page.locator(".bring-agent-btn")).toHaveCount(0);
});

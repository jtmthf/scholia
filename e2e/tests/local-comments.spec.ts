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
  "dim.md": "# Dim\n\nSomething about a passage now settled.\n",
  "emphasis.md": "# Emphasis\n\nSomething about a passage worth emphasis.\n",
  "outside-click.md": "# Outside Click\n\nA passage to click.\n",
  // Owned by the held-live-reload tests (issue #29), which rewrite them under a
  // reader who is mid-comment. One Page each: they assert what is *still* on
  // screen, so another test's write would be indistinguishable from the bug.
  "compose.md": "# Compose\n\nThe passage a reader is writing about.\n",
  "restore.md": "# Restore\n\nA passage worth returning to.\n",
  "resume.md": "# Resume\n\nA passage let go of again.\n",
  "drift.md": "# Drift\n\nA passage that will not survive the edit.\n",
  "hold-status.md":
    "# Hold Status\n\nA passage that is about to be deleted.\n\nA passage that stays put.\n",
  "server-rendered.md": "# Server Rendered\n\nReadable with JavaScript off.\n",
  "outdated-ssr.md": "# Outdated SSR\n\nNothing here says what the Anchor quotes.\n",
  "capabilities.md": "# Capabilities\n\nOnly what the Sidecar can do.\n",
  "many-comments.md": "# Many Comments\n\nA page with more Conversations than fit in one screen.\n",
  "resolve.md": "# Resolve\n\nSomething to settle.\n",
  "react.md": "# React\n\nSomething to react to.\n",
  "edit.md": "# Edit\n\nSomething to rewrite.\n",
  "delete.md": "# Delete\n\nSomething to take back.\n",
  "moderate.md": "# Moderate\n\nSomething the Owner can remove.\n",
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

/** Remove every Conversation for a Page so retries start from a known empty state. */
async function clearPage(request: APIRequestContext, page: string): Promise<void> {
  const conversations = await stored(request, page);
  for (const c of conversations) {
    const res = await request.post(`${preview.url}/__conversations/${c.id}/delete`, {
      headers: { "Sec-Fetch-Site": "same-origin" },
      data: { page },
    });
    expect(res.status()).toBe(200);
  }
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

/** Seed a private Chat without a browser. */
async function seedChat(
  request: APIRequestContext,
  page: string,
  body: string,
  exact?: string,
): Promise<void> {
  const res = await request.post(`${preview.url}/__conversations`, {
    headers: { "Sec-Fetch-Site": "same-origin" },
    data: {
      page,
      body,
      visibility: "private",
      ...(exact ? { selection: { quote: { exact } } } : {}),
    },
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
  return paintedIn(page, "scholia-anchor");
}

/**
 * How many ranges are registered under one of the three Custom Highlight API
 * registrations `AnchorHighlights` uses (issue #109): `scholia-anchor` (open),
 * `scholia-anchor-resolved` (dimmed), or `scholia-anchor-emphasis` (a hovered
 * rail card's passage).
 */
function paintedIn(page: Page, name: string): Promise<number> {
  return page.evaluate((n) => {
    const registry = (CSS as unknown as { highlights?: Map<string, { size: number }> }).highlights;
    return registry?.get(n)?.size ?? 0;
  }, name);
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

/**
 * Select `text` and wait for the Comment button the selection offers.
 *
 * Retried, because the selection is made programmatically and the listener that
 * answers it is attached by an effect once the rail hydrates. A real reader
 * drags for long enough to emit a stream of `selectionchange`, so a late
 * listener still catches one; this helper emits exactly one, and if it lands
 * before hydration nothing fires again and the button never comes. Re-selecting
 * is the same act a reader would repeat, and is idempotent.
 */
async function selectForComment(page: Page, text: string, occurrence: number): Promise<void> {
  await expect(async () => {
    await selectInContent(page, text, occurrence);
    await expect(page.locator("#scholia-comment-selection")).toBeVisible({ timeout: 1_000 });
  }).toPass();
}

/** Select `text`, click Comment, write `body`, submit — and wait for the card. */
async function commentOnSelection(
  page: Page,
  text: string,
  body: string,
  occurrence = 0,
): Promise<void> {
  await selectForComment(page, text, occurrence);
  await page.locator("#scholia-comment-selection").click();
  await page.locator(".floating-composer-panel textarea").fill(body);
  await page.locator(".floating-composer-panel button[type=submit]").click();
  await expect(page.locator(".comment-rail")).toContainText(body);
}

/** Select `text`, click Ask (private Chat), write `body`, submit — and wait. */
async function askOnSelection(
  page: Page,
  text: string,
  body: string,
  occurrence = 0,
): Promise<void> {
  await selectForComment(page, text, occurrence);
  await page.locator("#scholia-ask-selection").click();
  await page.locator(".floating-composer-panel textarea").fill(body);
  await page.locator(".floating-composer-panel button[type=submit]").click();
  await expect(page.locator(".rail-section--chats")).toContainText(body);
}

test("select text, comment, reload — the Conversation is still anchored", async ({
  page,
  request,
}) => {
  await clearPage(request, "anchor.md");
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
  await expect(page.locator(".rail-section-title").first()).toHaveText("Open (1)");

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

// issue #109: a settled Conversation must not go on accumulating a
// full-strength highlight — the passage moves to the dimmed registration
// instead of staying in the one open Threads use.
test("resolving a Conversation dims its passage instead of leaving it fully highlighted", async ({
  page,
  request,
}) => {
  await seedComment(request, "dim.md", "Settled now.", "a passage now settled");
  await page.goto(`${preview.url}/dim.md`);

  await expect.poll(() => paintedAnchors(page)).toBe(1);
  expect(await paintedIn(page, "scholia-anchor-resolved")).toBe(0);

  await page.locator(".thread-card .thread-action-btn--resolve").click();

  await expect.poll(() => paintedIn(page, "scholia-anchor-resolved")).toBe(1);
  expect(await paintedAnchors(page)).toBe(0);
});

// issue #109: hovering a rail card is the reader asking "where is that in the
// text" — the passage lights up in the emphasis registration, and leaving the
// card clears it again rather than leaving a stray emphasis behind.
test("hovering a rail card emphasizes its passage, and unhovering clears it", async ({
  page,
  request,
}) => {
  await seedComment(request, "emphasis.md", "Look here.", "a passage worth emphasis");
  await page.goto(`${preview.url}/emphasis.md`);

  await expect.poll(() => paintedAnchors(page)).toBe(1);
  // Give any late live reload from earlier tests a moment to settle before we
  // start asserting hover state; the anchor highlight is the signal that the
  // client and server are in sync.
  await page.waitForTimeout(300);
  expect(await paintedIn(page, "scholia-anchor-emphasis")).toBe(0);

  await page.locator(".thread-card").hover();
  await expect.poll(() => paintedIn(page, "scholia-anchor-emphasis")).toBe(1);

  await page.mouse.move(0, 0);
  await expect.poll(() => paintedIn(page, "scholia-anchor-emphasis")).toBe(0);
});

// issue #109: `thread-card--active` was set on activation and never cleared —
// a click that lands on neither a highlighted passage nor the rail itself has
// to let go of it.
test("clicking outside any passage and outside the rail clears the active card", async ({
  page,
  request,
}) => {
  await seedComment(request, "outside-click.md", "Focus me.", "passage to click");
  await page.goto(`${preview.url}/outside-click.md`);

  // The highlighter resolves the Anchor into the DOM on its own effect; the
  // hit-test the click depends on has nothing to hit until then.
  await expect.poll(() => paintedAnchors(page)).toBe(1);

  const at = await centreOf(page, "passage to click");
  await page.mouse.click(at.x, at.y);
  await expect(page.locator(".thread-card--active")).toHaveCount(1);

  await page.locator("article.markdown-body h1").click();
  await expect(page.locator(".thread-card--active")).toHaveCount(0);
});

// An Anchor whose quote is no longer in the Page can't be painted. It must still
// render — with its original quote, which is what an Outdated Conversation is
// for (CONTEXT "Outdated") — rather than vanish. Locally the file is live, so
// Outdated is not a stored status but the answer to "does this quote still match
// the text as it now stands", recomputed by the server on every read through the
// same matcher the hosted path uses (ADR-0029, issue #30).
test("a Conversation whose passage is gone renders as Outdated, unpainted", async ({
  page,
  request,
}) => {
  await seedComment(request, "gone.md", "About text that no longer exists.", "a passage long gone");
  await page.goto(`${preview.url}/gone.md`);

  await expect(page.locator(".thread-card")).toHaveCount(1);
  await expect(page.locator(".rail-section--outdated .thread-card")).toHaveCount(1);
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

  // Anchors are re-resolved on the server now (issue #30), so Outdated is a fact
  // about the first response rather than something the rail works out once it
  // hydrates. With JavaScript off there is no second chance to say so.
  test("an Outdated Conversation is Outdated in the first response", async ({ page, request }) => {
    await seedComment(request, "outdated-ssr.md", "About a passage since rewritten.", "long gone");
    await page.goto(`${preview.url}/outdated-ssr.md`);

    await expect(page.locator(".rail-section--outdated .thread-card")).toHaveCount(1);
    await expect(page.locator(".thread-anchor-quote")).toHaveText("“long gone”");
    await expect(page.locator(".comment-rail")).toContainText("About a passage since rewritten.");
  });

  test("a page-level comment posts through the form", async ({ page }) => {
    await page.goto(`${preview.url}/page-level.md`);

    await page.locator(".rail-toolbar .composer textarea").fill("No-JS page comment.");
    await page.locator(".rail-toolbar .composer button[type=submit]").click();

    await expect(page.locator(".comment-rail")).toContainText("No-JS page comment.");
  });

  test("a reply posts through the form", async ({ page, request }) => {
    await clearPage(request, "reply.md");
    await seedComment(request, "reply.md", "First word.");
    await page.goto(`${preview.url}/reply.md`);

    await page.locator(".thread-reply textarea").fill("Second word.");
    await page.locator(".thread-reply button[type=submit]").click();

    await expect(page.locator(".thread-card .comment")).toHaveCount(2);
  });

  test("resolving posts through the form", async ({ page, request }) => {
    await clearPage(request, "resolve.md");
    await seedComment(request, "resolve.md", "Is this settled?");
    await page.goto(`${preview.url}/resolve.md`);

    await page.locator(".thread-action-btn--resolve").click();
    await expect(page.locator(".thread-card--resolved")).toHaveCount(1);
  });

  test("an edit posts through the form", async ({ page, request }) => {
    await clearPage(request, "edit.md");
    await seedComment(request, "edit.md", "Frist draft.");
    await page.goto(`${preview.url}/edit.md`);

    await page.locator(".comment-edit-form textarea").fill("First draft.");
    await page.locator(".comment-edit-form button[type=submit]").click();

    await expect(page.locator(".comment-body")).toHaveText("First draft.");
    await expect(page.locator(".comment-edited")).toBeVisible();
  });

  test("deleting a Comment posts through the form", async ({ page, request }) => {
    await clearPage(request, "delete.md");
    await seedComment(request, "delete.md", "Said in haste.");
    await page.goto(`${preview.url}/delete.md`);

    await page.locator(".comment-action-btn", { hasText: "Delete Comment" }).click();

    await expect(page.locator(".comment-tombstone")).toBeVisible();
    await expect(page.locator(".comment-rail")).not.toContainText("Said in haste.");
  });

  test("the Owner deletes a whole Conversation through the form", async ({ page, request }) => {
    await clearPage(request, "moderate.md");
    await seedComment(request, "moderate.md", "Off topic entirely.");
    await page.goto(`${preview.url}/moderate.md`);

    await page.locator(".thread-action-btn--delete").click();

    await expect(page.locator(".thread-card")).toHaveCount(0);
  });

  test("a reaction posts through the form", async ({ page, request }) => {
    await clearPage(request, "react.md");
    await seedComment(request, "react.md", "Worth a look.");
    await page.goto(`${preview.url}/react.md`);

    await page.locator(".thread-card .reaction-chip", { hasText: "👍" }).click();

    await expect(page.locator(".thread-card .reaction-chip--mine")).toContainText("1");

    await page.locator(".thread-card .reaction-chip--mine").click();
    await expect(page.locator(".thread-card .reaction-chip--mine")).toHaveCount(0);
  });

  test("promoting a Chat posts through the form", async ({ page, request }) => {
    await clearPage(request, "capabilities.md");
    await seedChat(request, "capabilities.md", "Unbounded retry loop.");
    await page.goto(`${preview.url}/capabilities.md`);

    const myChat = page.locator(".rail-section--chats .thread-card", {
      hasText: "Unbounded retry loop.",
    });
    await myChat.locator(".thread-action-btn--promote").click();

    await expect(
      page.locator(".rail-section:not(.rail-section--chats):not(.rail-section--outdated)"),
    ).toContainText("Unbounded retry loop.");
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

test("a Page-level comment joins the Open section, distinguished as a Page Comment on its card", async ({
  page,
}) => {
  await page.goto(`${preview.url}/page-level.md`);

  // Local Preview renders the page-level composer as a real form in the rail
  // toolbar so the rail works without JavaScript (ADR-0034). The client
  // preventDefaults the submit and calls the same port method.
  await page.locator(".rail-toolbar .composer textarea").fill("About this page as a whole.");
  await page.locator(".rail-toolbar .composer button[type=submit]").click();

  await expect(page.locator(".rail-section-title")).toHaveText("Open (1)");
  await expect(page.locator(".thread-anchor-quote")).toHaveText("Page Comment");

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
test("a reply lands in the Conversation it answers", async ({ page, request }) => {
  // Seed the Conversation directly so this test is about replying, not about
  // the selection path that can race with live reload from earlier tests.
  // Clear first because retries share the same Sidecar directory.
  await clearPage(request, "reply.md");
  await seedComment(request, "reply.md", "First word.", "Reply target");
  await page.goto(`${preview.url}/reply.md`);

  await expect(page.locator(".thread-card")).toHaveCount(1);

  // Local Preview renders the reply composer as a real form so the rail works
  // without JavaScript (ADR-0034). The client preventDefaults the submit and
  // calls the same port method.
  await page.locator(".thread-reply textarea").fill("Second word.");
  await page.locator(".thread-reply button[type=submit]").click();

  await expect(page.locator(".thread-card")).toHaveCount(1);
  await expect(page.locator(".thread-card .comment")).toHaveCount(2);

  await page.reload();
  await expect(page.locator(".thread-card .comment")).toHaveCount(2);
  await expect(page.locator(".thread-card")).toContainText("Second word.");
});

// Issue #102: `#scholia-comments` — the `position: sticky` box clamped to the
// viewport — is the rail's scroll container, so a stack of Conversations taller
// than one screen stays reachable there rather than painting past its own edge.
// 18 is an ordinary review load, not a token few, so that is the number this
// asserts against. Scrolling is asserted on `#scholia-comments` itself, not
// merely on the card's eventual visibility: `.comment-rail` used to carry its
// own independent `overflow-y: auto` too, which happened to make the card
// reachable by the same wheel gesture for the wrong reason (two candidate scroll
// containers stacked on top of each other) — asserting the box named in the
// issue is what pins the fix rather than a coincidence of the old layout.
test("every Conversation is reachable by scrolling the rail, past a viewport's worth", async ({
  page,
  request,
}) => {
  for (let i = 1; i <= 18; i++) {
    await seedComment(request, "many-comments.md", `Comment number ${i}.`);
  }
  await page.goto(`${preview.url}/many-comments.md`);

  const cards = page.locator(".thread-card");
  await expect(cards).toHaveCount(18);

  const last = cards.last();
  await expect(last).toContainText("Comment number 18.");
  await expect(last).not.toBeInViewport();

  const rail = page.locator("#scholia-comments");
  const railBox = (await rail.boundingBox())!;
  await page.mouse.move(railBox.x + railBox.width / 2, railBox.y + railBox.height / 2);
  await page.mouse.wheel(0, 10_000);

  await expect(last).toBeInViewport();
  expect(await rail.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

// @scholia/ui renders an absent port method as an affordance this surface
// doesn't have — not one that fails when clicked (ADR-0030). Local Preview
// supplies every method the Sidecar can honour (ADR-0032). A Thread does not
// offer Promote — only a Chat card does.
test("offers only what the Sidecar can actually do", async ({ page, request }) => {
  // Earlier tests (including the no-JavaScript promote test) may have left
  // private Chats on this Page. Scope to the Thread we just seeded.
  await seedComment(request, "capabilities.md", "Something to act on.");
  await page.goto(`${preview.url}/capabilities.md`);

  const card = page.locator(".thread-card", { hasText: "Something to act on." }).first();
  // Local Preview renders real forms for every verb the Sidecar can honour, so
  // the rail works without JavaScript (ADR-0034). The reply composer sits below
  // the comments; resolve/delete are form-backed buttons.
  await expect(card.locator(".thread-reply")).toBeVisible();
  await expect(card.locator(".thread-action-btn--resolve")).toBeVisible();
  await expect(card.locator(".thread-action-btn--delete")).toBeVisible();
  // The six palette entries are always rendered as forms so the rail works
  // without JavaScript (ADR-0034); the add chip is only needed when the palette
  // is hidden behind a click.
  await expect(card.locator(".reaction-chip")).toHaveCount(6);
  await expect(card.locator(".thread-action-btn--promote")).toHaveCount(0);
  // No tokens to hand out locally, so no "Bring your agent".
  await expect(page.locator(".bring-agent-btn")).toHaveCount(0);
});

// A Chat card carries the lock affordance and a Promote control (issue #31).
// The Thread test above proves Promote is absent from a public Thread card.
test("a Chat card offers the Promote control", async ({ page, request }) => {
  await clearPage(request, "capabilities.md");
  await seedChat(request, "capabilities.md", "A private thought.");
  await page.goto(`${preview.url}/capabilities.md`);

  // The Chat card has a promote button.
  const chatCard = page.locator(".rail-section--chats .thread-card", {
    hasText: "A private thought.",
  });
  await expect(chatCard.locator(".thread-action-btn--promote")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Holding live reload while composing (issue #29).
//
// Local Preview watches the tree, so the reader's agent rewriting the file
// mid-comment is the normal case rather than an edge one. Every test here writes
// a real file under the served root and lets chokidar and the SSE stream do what
// they do — the claim is about what is still on screen afterwards.
// ---------------------------------------------------------------------------

/** The rail's Composer panel — open while a Conversation is being written. */
function composer(page: Page) {
  return page.locator(".floating-composer-panel textarea");
}

// The ticket's own test: begin composing, modify the file underneath, confirm
// the draft and the selection survive. Both halves are here in one run, because
// the claim is about one reader in one sitting — and because the selection can
// only be read back from the browser before the Composer takes focus, so the two
// assertions have to be sequenced rather than split across tests.
test("a Page rewritten mid-comment keeps the selection and the draft", async ({ page }) => {
  await page.goto(`${preview.url}/compose.md`);
  const article = page.locator("article.markdown-body");

  // First, with a selection live and nothing said about it yet — precisely when
  // losing it hurts.
  await selectForComment(page, "The passage", 0);
  await preview.write("compose.md", "# Compose\n\nThe passage a reader is writing about, once.\n");

  // The swap waits, and says so — unobtrusively, and without blocking anything.
  await expect(page.locator("#scholia-content-changed")).toBeVisible();
  await expect(article).not.toContainText("once");
  // The selection itself, read back from the browser — not merely the affordance.
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("The passage");
  await expect(page.locator("#scholia-comment-selection")).toBeVisible();

  // Then with words in the Composer, and the agent writing again underneath.
  await page.locator("#scholia-comment-selection").click();
  await composer(page).fill("Half a thought about this.");
  await preview.write("compose.md", "# Compose\n\nThe passage a reader is writing about, twice.\n");

  await expect(page.locator("#scholia-content-changed")).toBeVisible();
  await expect(article).not.toContainText("twice");
  await expect(composer(page)).toHaveValue("Half a thought about this.");

  // Taking the update is the reader's own act, and costs them nothing.
  await page.locator(".content-changed-btn").click();
  await expect(article).toContainText("twice");
  await expect(page.locator("#scholia-content-changed")).toHaveCount(0);
  await expect(composer(page)).toHaveValue("Half a thought about this.");

  // And the Comment still posts, against the passage it was written about.
  await page.locator(".floating-composer-panel button[type=submit]").click();
  await expect(page.locator(".comment-rail")).toContainText("Half a thought about this.");
  await expect(page.locator(".thread-anchor-quote")).toHaveText("“The passage”");
});

// The other way a Composer can lose its words: the whole document is rebuilt,
// which is what the swap falls back to when it fails — and what a refresh does.
// Holding covers neither, so the draft is on disk beside the tab instead.
test("a draft is still there after the page is rebuilt from scratch", async ({ page }) => {
  await page.goto(`${preview.url}/restore.md`);

  await selectForComment(page, "A passage worth returning to", 0);
  await page.locator("#scholia-comment-selection").click();
  await composer(page).fill("Picking this up again later.");

  await page.reload();

  await expect(composer(page)).toHaveValue("Picking this up again later.");

  // And it is still the same Conversation it was going to be, anchored to the
  // passage it was written about.
  await page.locator(".floating-composer-panel button[type=submit]").click();
  await expect(page.locator(".thread-anchor-quote")).toHaveText("“A passage worth returning to”");

  // Posted, so there is nothing left to restore.
  await page.reload();
  await expect(page.locator(".floating-composer-panel")).toHaveCount(0);
});

test("reloads resume by themselves once composing ends", async ({ page }) => {
  await page.goto(`${preview.url}/resume.md`);

  await selectForComment(page, "A passage let go", 0);
  await page.locator("#scholia-comment-selection").click();
  await composer(page).fill("Never mind.");

  await preview.write("resume.md", "# Resume\n\nA passage let go of again, and rewritten.\n");
  await expect(page.locator("#scholia-content-changed")).toBeVisible();

  // Nothing is being composed any more, so the ground is free to move — without
  // the reader having to take the update explicitly.
  await page.locator(".floating-composer-panel button", { hasText: "Cancel" }).click();

  await expect(page.locator("article.markdown-body")).toContainText("and rewritten");
  await expect(page.locator("#scholia-content-changed")).toHaveCount(0);

  // And the next change lands the way it did before any of this.
  await preview.write("resume.md", "# Resume\n\nA passage let go of again, and again.\n");
  await expect(page.locator("article.markdown-body")).toContainText("and again");
});

// The other half of "accept optimistically": the passage really is gone by the
// time the Comment is posted. It is created anyway, and its original quote is
// what makes it Outdated rather than meaningless (CONTEXT "Outdated").
test("a Comment posted after its passage vanished is kept, as Outdated", async ({
  page,
  request,
}) => {
  await page.goto(`${preview.url}/drift.md`);

  await selectForComment(page, "A passage that will not survive", 0);
  await page.locator("#scholia-comment-selection").click();
  await composer(page).fill("Worth saying even so.");

  await preview.write("drift.md", "# Drift\n\nEntirely different words now.\n");
  await expect(page.locator("#scholia-content-changed")).toBeVisible();
  await page.locator(".content-changed-btn").click();
  await expect(page.locator("article.markdown-body")).toContainText("Entirely different words");

  await page.locator(".floating-composer-panel button[type=submit]").click();

  // Kept, and told apart from a Conversation that still matches.
  await expect(page.locator(".rail-section--outdated .thread-card")).toHaveCount(1);
  await expect(page.locator(".comment-rail")).toContainText("Worth saying even so.");
  await expect(page.locator(".thread-anchor-quote")).toHaveText(
    "“A passage that will not survive”",
  );
  expect(await stored(request, "drift.md")).toHaveLength(1);
});

// Where holding the ground still (issue #29) meets re-resolving on read (#30).
//
// Every response the server sends describes the file as it stands on disk, and
// that includes each Anchor's status. While an update is held, what is on screen
// is an earlier render — so applying those statuses would move cards into
// Outdated and take highlights off passages the reader can still see, which is
// the ground moving under someone mid-sentence. The statuses wait for the
// content they are about.
test("statuses wait for the content they describe while a reader is composing", async ({
  page,
  request,
}) => {
  await seedComment(request, "hold-status.md", "About a doomed passage.", "about to be deleted");
  await page.goto(`${preview.url}/hold-status.md`);

  await expect(page.locator(".rail-section-title").first()).toHaveText("Open (1)");
  await expect.poll(() => paintedAnchors(page)).toBe(1);

  // Composing holds the swap — and the reader is looking at the passage.
  await selectForComment(page, "A passage that stays put", 0);
  await page.locator("#scholia-comment-selection").click();
  await composer(page).fill("Still writing this.");

  await preview.write("hold-status.md", "# Hold Status\n\nA passage that stays put.\n");
  await expect(page.locator("#scholia-content-changed")).toBeVisible();

  // A write of their own, mid-sentence: the reply comes back resolved against
  // the file on disk, where the quoted passage is already gone.
  await page.locator(".thread-card .reaction-chip").filter({ hasText: "👍" }).click();
  await expect(page.locator(".thread-card .reaction-chip--mine")).toContainText("1");

  // The card has not moved, and its passage is still painted where the reader
  // can see it.
  await expect(page.locator(".rail-section--outdated")).toHaveCount(0);
  await expect(page.locator("article.markdown-body")).toContainText("about to be deleted");
  expect(await paintedAnchors(page)).toBe(1);

  // Taking the update brings the content and the verdict about it together.
  await page.locator(".content-changed-btn").click();
  await expect(page.locator("article.markdown-body")).not.toContainText("about to be deleted");
  await expect(page.locator(".rail-section--outdated .thread-card")).toHaveCount(1);
  await expect(page.locator(".rail-section--outdated .thread-anchor-quote")).toHaveText(
    "“about to be deleted”",
  );
  await expect.poll(() => paintedAnchors(page)).toBe(0);
});

// ---------------------------------------------------------------------------
// The rest of the verb set (issue #32) in a real browser.
//
// The claim each of these makes is the same: the click produced an *event* on
// disk, so the state survives a reload. Nothing here asserts an in-memory rail.
// ---------------------------------------------------------------------------

test("resolving collapses the Conversation, and reopening brings it back", async ({
  page,
  request,
}) => {
  await clearPage(request, "resolve.md");
  await seedComment(request, "resolve.md", "Is this settled?");
  await page.goto(`${preview.url}/resolve.md`);

  const card = page.locator(".thread-card").first();
  await card.locator(".thread-action-btn--resolve").click();

  await expect(page.locator(".thread-card--resolved")).toHaveCount(1);
  await expect(page.locator(".thread-resolved-badge")).toBeVisible();
  // Collapsed to a summary — the Conversation is settled, not deleted.
  await expect(page.locator(".thread-collapsed-summary")).toBeVisible();

  await page.reload();
  await expect(page.locator(".thread-card--resolved")).toHaveCount(1);
  await expect(page.locator(".thread-collapsed-summary")).toBeVisible();

  // Expanding names who settled it, and offers the way back.
  await page.locator(".thread-collapsed-summary").click();
  await expect(page.locator(".resolved-by")).toBeVisible();
  await page.locator(".thread-action-btn--resolve").click();

  await expect(page.locator(".thread-card--resolved")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".thread-card--resolved")).toHaveCount(0);
});

test("a reaction can be added and taken back from the fixed palette", async ({ page, request }) => {
  await clearPage(request, "react.md");
  await seedComment(request, "react.md", "Worth a look.");
  await page.goto(`${preview.url}/react.md`);

  // Locally the palette is always rendered as forms so the rail works without
  // JavaScript (ADR-0034). The client preventDefaults each form submit.
  const chips = page.locator(".thread-card .reaction-chip");
  await expect(chips).toHaveCount(6);

  await chips.filter({ hasText: "👍" }).click();

  const tally = page.locator(".thread-card .reaction-chip--mine");
  await expect(tally).toHaveCount(1);
  await expect(tally).toContainText("1");
  // The tally plus the five remaining palette entries.
  await expect(chips).toHaveCount(6);

  await page.reload();
  await expect(page.locator(".thread-card .reaction-chip--mine")).toContainText("1");

  // Clicking the chip again takes it back, leaving just the palette.
  await page.locator(".thread-card .reaction-chip--mine").click();
  await expect(page.locator(".thread-card .reaction-chip")).toHaveCount(6);

  await page.reload();
  await expect(page.locator(".thread-card .reaction-chip--mine")).toHaveCount(0);
});

test("an author edits their own Comment, and it says so", async ({ page, request }) => {
  await clearPage(request, "edit.md");
  await page.goto(`${preview.url}/edit.md`);

  await commentOnSelection(page, "Something to rewrite", "Frist draft.");

  // Local Preview renders the edit form as a real form below the body so the
  // rail works without JavaScript (ADR-0034). The client preventDefaults the
  // submit and calls the same port method.
  await page.locator(".comment-edit-form textarea").fill("First draft.");
  await page.locator(".comment-edit-form button[type=submit]").click();

  await expect(page.locator(".comment-body")).toHaveText("First draft.");
  await expect(page.locator(".comment-edited")).toBeVisible();

  await page.reload();
  await expect(page.locator(".comment-body")).toHaveText("First draft.");
  await expect(page.locator(".comment-edited")).toBeVisible();
});

// Issue #103: an in-app dialog, not native window.confirm — so the reader gets a
// consistent, distinguishable confirmation instead of a browser-chrome prompt.
test("deleting a Comment leaves a tombstone in place", async ({ page, request }) => {
  await clearPage(request, "delete.md");
  await page.goto(`${preview.url}/delete.md`);

  await commentOnSelection(page, "Something to take back", "Said in haste.");

  await page.locator(".comment-action-btn", { hasText: "Delete Comment" }).click();
  const dialog = page.locator(".confirm-dialog");
  await expect(dialog).toContainText("Delete this Comment?");
  await dialog.locator("button", { hasText: "Delete" }).click();

  await expect(page.locator(".comment-tombstone")).toBeVisible();
  await expect(page.locator(".comment-rail")).not.toContainText("Said in haste.");

  await page.reload();
  await expect(page.locator(".comment-tombstone")).toBeVisible();
});

// CONTEXT "Owner": the reader at this machine may remove a whole Conversation.
// The delete goes through a confirmation dialog naming what is lost, on purpose
// — it holds other people's words (issue #103).
test("the Owner deletes a whole Conversation, and it leaves the Page", async ({
  page,
  request,
}) => {
  await clearPage(request, "moderate.md");
  await seedComment(request, "moderate.md", "Off topic entirely.");
  await page.goto(`${preview.url}/moderate.md`);

  await page.locator(".thread-action-btn--delete").click();
  const dialog = page.locator(".confirm-dialog");
  await expect(dialog).toContainText("Delete this Conversation and its 1 Comment?");
  await dialog.locator("button", { hasText: "Delete" }).click();

  await expect(page.locator(".thread-card")).toHaveCount(0);
  await expect(page.locator(".rail-empty")).toBeVisible();

  await page.reload();
  await expect(page.locator(".thread-card")).toHaveCount(0);
  // The Sidecar still holds the file; what changed is what the fold shows.
  expect(await stored(request, "moderate.md")).toEqual([]);
});

// ---------------------------------------------------------------------------
// Private Chats and Promotion (issue #31)
// ---------------------------------------------------------------------------

// AC: a Chat can be started from a selection and is visible only locally.
test("creates a Chat from a selection and holds it in the Chats section", async ({
  page,
  request,
}) => {
  await clearPage(request, "reply.md");
  await page.goto(`${preview.url}/reply.md`);

  await askOnSelection(page, "Reply target", "Ask my agent about this.");

  // The Chat is in the private Chats section, not the public anchored one.
  const chats = page.locator(".rail-section--chats");
  await expect(chats).toBeVisible();
  await expect(chats.locator(".rail-section-title")).toHaveText("🔒 Private Chats (1)");
  await expect(chats.locator(".thread-card")).toHaveCount(1);
  await expect(chats.locator(".thread-card")).toContainText("Ask my agent about this.");

  // The lock affordance shows: this is private.
  await expect(chats.locator(".thread-lock")).toBeVisible();

  await page.reload();
  await expect(page.locator(".rail-section--chats .thread-card")).toHaveCount(1);
});

// AC: a Chat and a Thread may anchor to the same span without interfering.
test("a Chat and a Thread on the same span show in their own sections", async ({
  page,
  request,
}) => {
  await clearPage(request, "anchor.md");
  await page.goto(`${preview.url}/anchor.md`);

  await commentOnSelection(page, "the moat", "Public review comment.");
  await askOnSelection(page, "the moat", "Private agent question.");

  await expect(page.locator(".rail-section--chats .thread-card")).toHaveCount(1);
  // The anchored (public) section has one card.
  await expect(
    page.locator(
      ".rail-section:not(.rail-section--chats):not(.rail-section--outdated) .thread-card",
    ),
  ).toHaveCount(1);
});

// AC: Promotion writes a new Thread from selected messages, leaving the Chat.
test("promoting a Chat writes a new Thread", async ({ page, request }) => {
  await clearPage(request, "capabilities.md");
  await seedChat(request, "capabilities.md", "Unbounded retry loop.");
  await page.goto(`${preview.url}/capabilities.md`);

  // Open the Promote dialog on the Chat card.
  const myChat = page.locator(".rail-section--chats .thread-card", {
    hasText: "Unbounded retry loop.",
  });
  const promoteBtn = myChat.locator(".thread-action-btn--promote");
  await expect(promoteBtn).toBeVisible();
  await promoteBtn.click();

  // The Promote dialog opens.
  const dialog = page.locator(".promote-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".promote-title")).toHaveText("Promote to a public Thread");

  // The Chat's message is listed and checked by default.
  await expect(dialog.locator(".promote-comment")).toHaveCount(1);
  await expect(dialog.locator(".promote-comment input[type=checkbox]")).toBeChecked();
  await expect(dialog.locator(".promote-comment-body")).toHaveText("Unbounded retry loop.");

  // Add a summary.
  await dialog.locator(".promote-summary").fill("Worth raising with the team.");

  // Submit.
  await dialog.locator(".btn-primary").click();

  // The dialog closes, and a new Thread appears.
  await expect(dialog).toHaveCount(0);
  // The new Thread (public) contains the summary.
  await expect(
    page.locator(".rail-section:not(.rail-section--chats):not(.rail-section--outdated)"),
  ).toContainText("Worth raising with the team.");
  // The Chat is still in the private section.
  await expect(myChat).toBeVisible();
  await expect(myChat).toContainText("Unbounded retry loop.");
});

// AC: the Chat stays private and unchanged after promotion.
test("a promoted Chat is untouched — it stays private and in the Chats section", async ({
  page,
  request,
}) => {
  await clearPage(request, "capabilities.md");
  await seedChat(request, "capabilities.md", "Still private after promo.");
  await page.goto(`${preview.url}/capabilities.md`);

  // Promote it with a summary only (no messages).
  const myChat = page.locator(".rail-section--chats .thread-card", {
    hasText: "Still private after promo.",
  });
  const promoteBtn = myChat.locator(".thread-action-btn--promote");
  await promoteBtn.click();
  const dialog = page.locator(".promote-dialog");
  // Uncheck the message, use only the summary.
  await dialog.locator(".promote-comment input[type=checkbox]").uncheck();
  await dialog.locator(".promote-summary").fill("Summarised for the team.");
  await dialog.locator(".btn-primary").click();

  await expect(dialog).toHaveCount(0);

  // The Chat is still there, still private.
  await expect(myChat).toBeVisible();
  await expect(myChat).toContainText("Still private after promo.");

  await page.reload();
  await expect(
    page.locator(".rail-section--chats .thread-card", { hasText: "Still private after promo." }),
  ).toBeVisible();
});

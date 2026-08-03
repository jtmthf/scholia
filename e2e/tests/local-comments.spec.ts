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
  // Owned by the held-live-reload tests (issue #29), which rewrite them under a
  // reader who is mid-comment. One Page each: they assert what is *still* on
  // screen, so another test's write would be indistinguishable from the bug.
  "compose.md": "# Compose\n\nThe passage a reader is writing about.\n",
  "restore.md": "# Restore\n\nA passage worth returning to.\n",
  "resume.md": "# Resume\n\nA passage let go of again.\n",
  "drift.md": "# Drift\n\nA passage that will not survive the edit.\n",
  "server-rendered.md": "# Server Rendered\n\nReadable with JavaScript off.\n",
  "capabilities.md": "# Capabilities\n\nOnly what the Sidecar can do.\n",
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
// for (CONTEXT "Outdated") — rather than vanish. Locally the file is live, so
// Outdated is not a stored status but the answer to "does this quote still match
// the text as it now stands", decided in the browser against what is on screen.
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

// @scholia/ui renders an absent port method as an affordance this surface
// doesn't have — not one that fails when clicked (ADR-0030). Local Preview
// supplies every method the Sidecar can honour (ADR-0032). A Thread does not
// offer Promote — only a Chat card does.
test("offers only what the Sidecar can actually do", async ({ page, request }) => {
  await seedComment(request, "capabilities.md", "Something to act on.");
  await page.goto(`${preview.url}/capabilities.md`);

  const card = page.locator(".thread-card").first();
  await expect(card.locator(".thread-action-btn", { hasText: "Reply" })).toBeVisible();
  await expect(card.locator(".thread-action-btn--resolve")).toBeVisible();
  await expect(card.locator(".thread-action-btn--delete")).toBeVisible();
  await expect(card.locator(".reaction-chip")).toHaveCount(6);
  await expect(card.locator(".thread-action-btn--promote")).toHaveCount(0);
  // No tokens to hand out locally, so no "Bring your agent".
  await expect(page.locator(".bring-agent-btn")).toHaveCount(0);
});

// A Chat card carries the lock affordance and a Promote control (issue #31).
// The Thread test above proves Promote is absent from a public Thread card.
test("a Chat card offers the Promote control", async ({ page, request }) => {
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
  await seedComment(request, "react.md", "Worth a look.");
  await page.goto(`${preview.url}/react.md`);

  // No tallies yet, so the whole palette is offered — six and no picker.
  const chips = page.locator(".thread-card .reaction-chip");
  await expect(chips).toHaveCount(6);

  await chips.filter({ hasText: "👍" }).click();

  const tally = page.locator(".thread-card .reaction-chip--mine");
  await expect(tally).toHaveCount(1);
  await expect(tally).toContainText("1");

  await page.reload();
  await expect(page.locator(".thread-card .reaction-chip--mine")).toContainText("1");

  // Clicking the chip again takes it back, and the palette returns.
  await page.locator(".thread-card .reaction-chip--mine").click();
  await expect(page.locator(".thread-card .reaction-chip")).toHaveCount(6);

  await page.reload();
  await expect(page.locator(".thread-card .reaction-chip--mine")).toHaveCount(0);
});

test("an author edits their own Comment, and it says so", async ({ page }) => {
  await page.goto(`${preview.url}/edit.md`);

  await commentOnSelection(page, "Something to rewrite", "Frist draft.");

  await page.locator(".comment-action-btn", { hasText: "Edit" }).click();
  await page.locator(".comment-edit-form textarea").fill("First draft.");
  await page.locator(".comment-edit-form button[type=submit]").click();

  await expect(page.locator(".comment-body")).toHaveText("First draft.");
  await expect(page.locator(".comment-edited")).toBeVisible();

  await page.reload();
  await expect(page.locator(".comment-body")).toHaveText("First draft.");
  await expect(page.locator(".comment-edited")).toBeVisible();
});

test("deleting a Comment leaves a tombstone in place", async ({ page }) => {
  await page.goto(`${preview.url}/delete.md`);

  await commentOnSelection(page, "Something to take back", "Said in haste.");

  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator(".comment-action-btn", { hasText: "Delete" }).click();

  await expect(page.locator(".comment-tombstone")).toBeVisible();
  await expect(page.locator(".comment-rail")).not.toContainText("Said in haste.");

  await page.reload();
  await expect(page.locator(".comment-tombstone")).toBeVisible();
});

// CONTEXT "Owner": the reader at this machine may remove a whole Conversation.
// The delete takes two clicks on purpose — it holds other people's words.
test("the Owner deletes a whole Conversation, and it leaves the Page", async ({
  page,
  request,
}) => {
  await seedComment(request, "moderate.md", "Off topic entirely.");
  await page.goto(`${preview.url}/moderate.md`);

  await page.locator(".thread-action-btn--delete").click();
  await page.locator(".thread-action-btn--delete", { hasText: "Confirm delete" }).click();

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
test("creates a Chat from a selection and holds it in the Chats section", async ({ page }) => {
  await page.goto(`${preview.url}/reply.md`);

  await askOnSelection(page, "Reply target", "Ask my agent about this.");

  // The Chat is in the private Chats section, not the public anchored one.
  const chats = page.locator(".rail-section--chats");
  await expect(chats).toBeVisible();
  await expect(chats.locator(".rail-section-title")).toHaveText("🔒 Chats (private) (1)");
  await expect(chats.locator(".thread-card")).toHaveCount(1);
  await expect(chats.locator(".thread-card")).toContainText("Ask my agent about this.");

  // The lock affordance shows: this is private.
  await expect(chats.locator(".thread-lock")).toBeVisible();

  await page.reload();
  await expect(page.locator(".rail-section--chats .thread-card")).toHaveCount(1);
});

// AC: a Chat and a Thread may anchor to the same span without interfering.
test("a Chat and a Thread on the same span show in their own sections", async ({ page }) => {
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

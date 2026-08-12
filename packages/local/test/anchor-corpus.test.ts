// The local read path, driven by the committed corpus of real agent rewrites
// (packages/core/test/fixtures/anchor-migration/ — see its README).
//
// `migrateAnchor` is already pinned against this corpus in
// packages/core/test/anchor/migrate-corpus.test.ts, and this does not repeat
// that. What it adds is the wiring the local path puts around it (issue #30):
// a Page rendered from a file on disk, the *rendered* text taken from that
// render rather than from its markdown Source (ADR-0029), and a stored Anchor
// re-resolved against it on read.
//
// That wiring is exactly what the hand-written tests in conversations.test.ts
// cannot pin. A local path that matched against the Source, or against the
// rendered HTML instead of its text, would still answer every invented example
// correctly and then disagree with hosted on real edits. The claim here is that
// it does not: on every case the corpus labels, Local Preview reaches the same
// verdict the corpus does.
//
// The revisions are rendered through Local Preview's own `PageRenderer`, which
// stamps `data-sm` ids the hosted render does not. Agreeing with the corpus
// therefore also asserts that the stamps leave the rendered *text* alone — the
// layer everything anchors in.

import { expect } from "vitest";
import { test } from "./helpers/tmp.js";
import { PageRenderer } from "../src/render/page.js";
import { toConversationDTOs } from "../src/conversations.js";
import type { Conversation } from "@scholia/core";
import {
  expandToUnique,
  expectFor,
  loadRevisions,
  locate,
  readCases,
  selectionFor,
} from "@scholia/core/test/helpers/anchor-corpus.js";

const READER = "Reviewer Jane";

function conversationAnchoredTo(quote: {
  exact: string;
  prefix?: string;
  suffix?: string;
}): Conversation {
  return {
    header: {
      id: "00000000-0000-7000-8000-000000000001",
      page: "page.md",
      anchor: { textQuote: quote },
      author: READER,
      timestamp: "2026-01-01T00:00:00.000Z",
    },
    visibility: "public",
    comments: [],
    resolved: false,
    resolvedBy: null,
    resolvedAt: null,
    deleted: false,
  };
}

test("Local Preview reaches the corpus's verdict on every edit it labels", async ({ tmp }) => {
  const revisions = await loadRevisions();
  const cases = readCases();
  const pages = new PageRenderer({ mdxEnabled: false });

  // Every revision, as Local Preview renders it. Each is written once and
  // rendered once: the corpus reuses revisions across cases, and the render
  // pipeline is the expensive part of this file.
  const localText = new Map<string, string>();
  for (const [key, revision] of revisions) {
    const fsPath = await tmp.write(`${key.replace("@", "-v")}.md`, revision.source);
    localText.set(key, (await pages.render(fsPath)).text());
  }

  const disagreements: Array<{ id: string; expected: string; actual: string }> = [];
  let scored = 0;

  for (const c of cases) {
    const before = localText.get(`${c.chain}@${c.from}`);
    const after = localText.get(`${c.chain}@${c.to}`);
    if (!before || !after) continue;

    // Some labelled selections carry markdown syntax that vanishes when
    // rendered, so they are not locatable in this layer. Skipped, and the count
    // that survives is pinned below so a silent collapse to zero cannot pass.
    const at = locate(before, selectionFor(c, "rendered"));
    if (!at) continue;

    // The quote a real capture would have stored: expanded against the text as
    // it stood when the reader selected it.
    const quote = expandToUnique(before, at.start, at.end);
    const [dto] = toConversationDTOs([conversationAnchoredTo(quote)], READER, after);

    const expected = expectFor(c, "rendered") === "outdated" ? "outdated" : "live";
    scored++;
    if (dto!.anchorStatus !== expected) {
      disagreements.push({ id: c.id, expected, actual: dto!.anchorStatus });
    }
  }

  // Pinned, so a corpus that stopped loading — or selections that stopped being
  // locatable — fails loudly instead of passing with nothing scored.
  expect(scored).toBe(41);
  expect(disagreements).toEqual([]);
});

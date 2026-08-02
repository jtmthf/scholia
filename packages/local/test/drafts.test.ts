import { describe, expect, test } from "vitest";
import {
  clearDraft,
  loadDraft,
  loadLatestDraft,
  saveDraft,
  type DraftStorage,
} from "../src/client/comments/drafts.js";
import type { SelectionCandidate } from "@scholia/bridge";

// The promise (issue #29): a draft is never lost because the file moved under
// it. These are the storage rules that promise rests on — keyed per Anchor, so
// a draft comes back attached to the passage it was written about.

/** sessionStorage's contract, in a Map. */
function fakeStorage(): DraftStorage & { size: () => number } {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i) => Array.from(map.keys())[i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    size: () => map.size,
  };
}

function candidate(exact: string, prefix?: string): SelectionCandidate {
  return { quote: { exact, ...(prefix ? { prefix } : {}) }, smIds: [] };
}

describe("draft storage", () => {
  test("a saved draft comes back with its selection and body", () => {
    const store = fakeStorage();
    const selection = candidate("the moat");

    saveDraft(store, "anchor.md", { selection, body: "Half a thought", at: { left: 10, top: 20 } });

    const restored = loadLatestDraft(store, "anchor.md");
    expect(restored?.body).toBe("Half a thought");
    expect(restored?.selection).toEqual(selection);
    expect(restored?.at).toEqual({ left: 10, top: 20 });
  });

  test("a Page-level draft has no selection and is still restored", () => {
    const store = fakeStorage();
    saveDraft(store, "page.md", { selection: null, body: "About the whole page" });

    const restored = loadLatestDraft(store, "page.md");
    expect(restored?.selection).toBeNull();
    expect(restored?.body).toBe("About the whole page");
  });

  test("drafts are kept per Anchor, not per Page", () => {
    const store = fakeStorage();
    saveDraft(store, "doc.md", { selection: candidate("first passage"), body: "One" });
    saveDraft(store, "doc.md", { selection: candidate("second passage"), body: "Two" });

    expect(store.size()).toBe(2);
    // The one most recently written is the one the reader was in.
    expect(loadLatestDraft(store, "doc.md")?.body).toBe("Two");
  });

  test("selecting a passage again finds what was being written about it", () => {
    const store = fakeStorage();
    const abandoned = candidate("first passage");
    saveDraft(store, "doc.md", { selection: abandoned, body: "One" });
    saveDraft(store, "doc.md", { selection: candidate("second passage"), body: "Two" });

    expect(loadDraft(store, "doc.md", abandoned)?.body).toBe("One");
    expect(loadDraft(store, "doc.md", candidate("never written about"))).toBeNull();
  });

  test("the same Anchor overwrites rather than accumulating", () => {
    const store = fakeStorage();
    saveDraft(store, "doc.md", { selection: candidate("the moat"), body: "Ha" });
    saveDraft(store, "doc.md", { selection: candidate("the moat"), body: "Half a thought" });

    expect(store.size()).toBe(1);
    expect(loadLatestDraft(store, "doc.md")?.body).toBe("Half a thought");
  });

  test("the same words in different context are different Anchors", () => {
    const store = fakeStorage();
    saveDraft(store, "doc.md", { selection: candidate("See below", "first "), body: "One" });
    saveDraft(store, "doc.md", { selection: candidate("See below", "second "), body: "Two" });

    expect(store.size()).toBe(2);
  });

  test("another Page's drafts are not this Page's", () => {
    const store = fakeStorage();
    saveDraft(store, "a.md", { selection: candidate("shared words"), body: "On A" });
    saveDraft(store, "b.md", { selection: candidate("shared words"), body: "On B" });

    expect(loadLatestDraft(store, "a.md")?.body).toBe("On A");
    expect(loadLatestDraft(store, "b.md")?.body).toBe("On B");
  });

  test("clearing removes only that Anchor's draft", () => {
    const store = fakeStorage();
    const kept = candidate("kept passage");
    saveDraft(store, "doc.md", { selection: kept, body: "Keep" });
    saveDraft(store, "doc.md", { selection: candidate("dropped passage"), body: "Drop" });

    clearDraft(store, "doc.md", candidate("dropped passage"));

    expect(store.size()).toBe(1);
    expect(loadLatestDraft(store, "doc.md")?.body).toBe("Keep");
  });

  test("an empty body clears rather than storing nothing to restore", () => {
    const store = fakeStorage();
    const selection = candidate("the moat");
    saveDraft(store, "doc.md", { selection, body: "Something" });

    saveDraft(store, "doc.md", { selection, body: "   " });

    expect(store.size()).toBe(0);
    expect(loadLatestDraft(store, "doc.md")).toBeNull();
  });

  test("nothing saved means nothing to restore", () => {
    expect(loadLatestDraft(fakeStorage(), "doc.md")).toBeNull();
  });

  test("a corrupt entry is ignored rather than thrown", () => {
    const store = fakeStorage();
    saveDraft(store, "doc.md", { selection: candidate("good"), body: "Readable" });
    store.setItem("scholia:draft:doc.md:broken", "{not json");

    expect(loadLatestDraft(store, "doc.md")?.body).toBe("Readable");
  });

  test("a storage that refuses to write is not an error the reader sees", () => {
    const refusing: DraftStorage = {
      length: 0,
      key: () => null,
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("QuotaExceededError");
      },
    };

    expect(() => saveDraft(refusing, "doc.md", { selection: null, body: "x" })).not.toThrow();
    expect(() => clearDraft(refusing, "doc.md", null)).not.toThrow();
    expect(loadLatestDraft(refusing, "doc.md")).toBeNull();
  });
});

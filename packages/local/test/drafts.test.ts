import { describe, expect, test } from "vitest";
import { pageDrafts, type DraftStorage } from "../src/client/comments/drafts.js";
import type { SelectionCandidate } from "@scholia/bridge";

// The promise (issue #29): a draft is never lost because the file moved under
// it. These are the storage rules that promise rests on — keyed per Anchor, so
// a draft comes back attached to the passage it was written about.
//
// Updated for issue #31: drafts are further keyed by visibility, so a Chat
// draft and a Thread draft on the same passage are separate entries.

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

// A factory that injects a custom storage, since pageDrafts reads sessionStorage
// directly. This patches the global temporarily.
function withStorage<T>(storage: DraftStorage, fn: (storage: DraftStorage) => T): T {
  const original = globalThis.sessionStorage;
  // @ts-expect-error — we're replacing sessionStorage with a fake for testing
  globalThis.sessionStorage = storage;
  try {
    return fn(storage);
  } finally {
    globalThis.sessionStorage = original;
  }
}

describe("draft storage", () => {
  test("a saved draft comes back with its selection and body", () => {
    const store = fakeStorage();
    const selection = candidate("the moat");

    withStorage(store, () => {
      const drafts = pageDrafts("anchor.md");
      drafts.save({
        selection,
        body: "Half a thought",
        visibility: "public",
        at: { left: 10, top: 20 },
      });

      const restored = drafts.latest();
      expect(restored?.body).toBe("Half a thought");
      expect(restored?.selection).toEqual(selection);
      expect(restored?.visibility).toBe("public");
      expect(restored?.at).toEqual({ left: 10, top: 20 });
    });
  });

  test("a Page-level draft has no selection and is still restored", () => {
    const store = fakeStorage();
    withStorage(store, () => {
      const drafts = pageDrafts("page.md");
      drafts.save({ selection: null, body: "About the whole page", visibility: "public" });

      const restored = drafts.latest();
      expect(restored?.selection).toBeNull();
      expect(restored?.body).toBe("About the whole page");
    });
  });

  test("drafts are kept per Anchor, not per Page", () => {
    const store = fakeStorage();
    withStorage(store, () => {
      const drafts = pageDrafts("doc.md");
      drafts.save({ selection: candidate("first passage"), body: "One", visibility: "public" });
      drafts.save({ selection: candidate("second passage"), body: "Two", visibility: "public" });

      expect(store.size()).toBe(2);
      expect(drafts.latest()?.body).toBe("Two");
    });
  });

  test("selecting a passage again finds what was being written about it", () => {
    const store = fakeStorage();
    const abandoned = candidate("first passage");
    withStorage(store, () => {
      const drafts = pageDrafts("doc.md");
      drafts.save({ selection: abandoned, body: "One", visibility: "public" });
      drafts.save({ selection: candidate("second passage"), body: "Two", visibility: "public" });

      expect(drafts.load(abandoned)?.body).toBe("One");
      expect(drafts.load(candidate("never written about"))).toBeNull();
    });
  });

  test("the same Anchor overwrites rather than accumulating", () => {
    const store = fakeStorage();
    withStorage(store, () => {
      const drafts = pageDrafts("doc.md");
      drafts.save({ selection: candidate("the moat"), body: "Ha", visibility: "public" });
      drafts.save({
        selection: candidate("the moat"),
        body: "Half a thought",
        visibility: "public",
      });

      expect(store.size()).toBe(1);
      expect(drafts.latest()?.body).toBe("Half a thought");
    });
  });

  test("the same words in different context are different Anchors", () => {
    const store = fakeStorage();
    withStorage(store, () => {
      const drafts = pageDrafts("doc.md");
      drafts.save({
        selection: candidate("See below", "first "),
        body: "One",
        visibility: "public",
      });
      drafts.save({
        selection: candidate("See below", "second "),
        body: "Two",
        visibility: "public",
      });

      expect(store.size()).toBe(2);
    });
  });

  test("another Page's drafts are not this Page's", () => {
    const store = fakeStorage();
    withStorage(store, () => {
      pageDrafts("a.md").save({
        selection: candidate("shared words"),
        body: "On A",
        visibility: "public",
      });
      pageDrafts("b.md").save({
        selection: candidate("shared words"),
        body: "On B",
        visibility: "public",
      });

      expect(pageDrafts("a.md").latest()?.body).toBe("On A");
      expect(pageDrafts("b.md").latest()?.body).toBe("On B");
    });
  });

  test("clearing removes only that Anchor's draft", () => {
    const store = fakeStorage();
    const kept = candidate("kept passage");
    withStorage(store, () => {
      const drafts = pageDrafts("doc.md");
      drafts.save({ selection: kept, body: "Keep", visibility: "public" });
      drafts.save({ selection: candidate("dropped passage"), body: "Drop", visibility: "public" });

      drafts.clear(candidate("dropped passage"));

      expect(store.size()).toBe(1);
      expect(drafts.latest()?.body).toBe("Keep");
    });
  });

  test("an empty body is stored like any other — the caller decides when to clear", () => {
    const store = fakeStorage();
    const selection = candidate("the moat");
    withStorage(store, () => {
      const drafts = pageDrafts("doc.md");
      drafts.save({ selection, body: "Something", visibility: "public" });
      drafts.save({ selection, body: "   ", visibility: "public" });

      // pageDrafts stores whatever it's given. Clearing the draft after post
      // or on cancel is the CommentLayer's responsibility.
      expect(drafts.load(selection)?.body).toBe("   ");
    });
  });

  test("nothing saved means nothing to restore", () => {
    const store = fakeStorage();
    withStorage(store, () => {
      expect(pageDrafts("doc.md").latest()).toBeNull();
    });
  });

  test("a Chat draft and a Thread draft on the same passage are separate entries", () => {
    const store = fakeStorage();
    const selection = candidate("the moat");
    withStorage(store, () => {
      const drafts = pageDrafts("doc.md");
      drafts.save({ selection, body: "Public comment", visibility: "public" });
      drafts.save({ selection, body: "Private chat", visibility: "private" });

      expect(store.size()).toBe(2);
      expect(drafts.load(selection, "public")?.body).toBe("Public comment");
      expect(drafts.load(selection, "private")?.body).toBe("Private chat");
    });
  });

  test("a corrupt entry is ignored rather than thrown", () => {
    const store = fakeStorage();
    withStorage(store, () => {
      const drafts = pageDrafts("doc.md");
      drafts.save({ selection: candidate("good"), body: "Readable", visibility: "public" });
      store.setItem("scholia:draft:doc.md:public:broken", "{not json");

      expect(drafts.latest()?.body).toBe("Readable");
    });
  });
});

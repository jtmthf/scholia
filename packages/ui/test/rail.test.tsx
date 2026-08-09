import { describe, expect, it } from "vitest";
import { Rail } from "../src/index.js";
import { comment, conversation, occurrences, render, stubPort } from "./helpers/fixtures.js";

// The rail's whole job is sorting Conversations into sections and deciding which
// entry points a surface gets. Both are pure functions of props, so they're worth
// pinning here rather than in a browser.
describe("Rail", () => {
  const anchored = conversation({ id: "anchored" });
  const pageLevel = conversation({ id: "page-level", anchor: null });
  const outdated = conversation({ id: "outdated", anchorStatus: "outdated", createdOrdinal: 2 });
  const chat = conversation({ id: "chat", visibility: "private" });

  const full = (
    <Rail
      conversations={[anchored, pageLevel, outdated]}
      chats={[chat]}
      activeConversationId={null}
      onActivate={() => {}}
      onNewPageComment={() => {}}
    />
  );

  it("splits Conversations into Chats, anchored, page-level and Outdated sections", () => {
    const html = render(full);

    expect(html).toContain("🔒 Private Chats (1)");
    expect(html).toContain("Anchored (1)");
    expect(html).toContain("Page Comments (1)");
    expect(html).toContain("Outdated (1)");
    // Four Conversations in, four cards out — an Outdated one is moved, not dropped.
    expect(occurrences(html, 'class="thread-card')).toBe(4);
  });

  it("renders an empty-state instead of sections when there is nothing to show", () => {
    const html = render(
      <Rail
        conversations={[]}
        chats={[]}
        activeConversationId={null}
        onActivate={() => {}}
        onNewPageComment={() => {}}
      />,
    );

    expect(html).toContain("No Comments yet.");
    expect(html).not.toContain("rail-section");
  });

  it("marks only the active Conversation's card active", () => {
    const html = render(
      <Rail
        conversations={[anchored, pageLevel]}
        chats={[]}
        activeConversationId="page-level"
        onActivate={() => {}}
        onNewPageComment={() => {}}
      />,
    );

    expect(occurrences(html, "thread-card--active")).toBe(1);
  });

  // The Chats section always offers Promote, because every Chat in it is the
  // reader's own (CONTEXT "Promotion").
  it("gives Chat cards the lock and the Promote control, and public Threads neither", () => {
    const html = render(full);

    expect(occurrences(html, "thread-card--private")).toBe(1);
    expect(occurrences(html, "thread-lock")).toBe(1);
    expect(occurrences(html, "thread-action-btn--promote")).toBe(1);
  });

  describe("agent entry point", () => {
    // A surface with no tokens (Local Preview) has nothing to hand an agent, so
    // the affordance has to be absent rather than inert.
    it("is omitted when the consumer supplies no onBringAgent", () => {
      const html = render(full);
      expect(html).not.toContain("bring-agent-btn");
      expect(html).toContain("page-comment-btn");
    });

    it("is rendered when the consumer supplies one", () => {
      const html = render(
        <Rail
          conversations={[]}
          chats={[]}
          activeConversationId={null}
          onActivate={() => {}}
          onNewPageComment={() => {}}
          onBringAgent={() => {}}
        />,
      );
      expect(html).toContain("bring-agent-btn");
    });
  });

  describe("Outdated origin link", () => {
    it("is omitted when the consumer supplies no outdatedOrigin", () => {
      const html = render(full);
      expect(html).toContain("Outdated (1)");
      expect(html).not.toContain("outdated-origin");
    });

    it("uses the href and label the consumer builds", () => {
      const html = render(
        <Rail
          conversations={[outdated]}
          chats={[]}
          activeConversationId={null}
          onActivate={() => {}}
          onNewPageComment={() => {}}
          outdatedOrigin={(c) => ({
            href: `/s/abc/${c.pagePath}?v=${c.createdOrdinal}`,
            label: `from v${c.createdOrdinal} ↗`,
          })}
        />,
      );

      expect(html).toContain('href="/s/abc/guide/intro.md?v=2"');
      expect(html).toContain("from v2 ↗");
    });

    // What the Threads drifted *from* is the consumer's to name: a hosted Site has
    // Versions, Local Preview only has the file as it stands.
    it("lets the consumer word the section's note", () => {
      const html = render(
        <Rail
          conversations={[outdated]}
          chats={[]}
          activeConversationId={null}
          onActivate={() => {}}
          onNewPageComment={() => {}}
          outdatedNote="These Threads no longer match the Latest Version."
        />,
      );

      expect(html).toContain("These Threads no longer match the Latest Version.");
    });

    it("is omitted for a Conversation the consumer can't address", () => {
      const html = render(
        <Rail
          conversations={[outdated]}
          chats={[]}
          activeConversationId={null}
          onActivate={() => {}}
          onNewPageComment={() => {}}
          outdatedOrigin={() => null}
        />,
      );

      expect(html).not.toContain("outdated-origin");
    });
  });

  it("shows the owner moderation control on every card only when the port allows it", () => {
    const withoutModeration = render(full);
    expect(withoutModeration).not.toContain("thread-action-btn--delete");

    const withModeration = render(full, stubPort({ canModerate: true }));
    expect(occurrences(withModeration, "thread-action-btn--delete")).toBe(4);
  });

  it("renders a Chat's Comments, not just its header", () => {
    const html = render(
      <Rail
        conversations={[]}
        chats={[conversation({ visibility: "private", comments: [comment({ body: "ask me" })] })]}
        activeConversationId={null}
        onActivate={() => {}}
        onNewPageComment={() => {}}
      />,
    );

    expect(html).toContain("ask me");
  });
});

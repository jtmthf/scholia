import { describe, expect, it } from "vitest";
import { Rail } from "../src/index.js";
import { comment, conversation, occurrences, render, stubPort } from "./helpers/fixtures.js";

// The rail's whole job is sorting Conversations into sections and deciding which
// entry points a surface gets. Both are pure functions of props, so they're worth
// pinning here rather than in a browser.
describe("Rail", () => {
  const anchored = conversation({ id: "anchored" });
  const pageLevel = conversation({ id: "page-level", anchor: null });
  const resolved = conversation({
    id: "resolved",
    resolved: true,
    resolvedBy: "Reviewer Jane",
  });
  const outdated = conversation({ id: "outdated", anchorStatus: "outdated", createdOrdinal: 2 });
  const chat = conversation({ id: "chat", visibility: "private" });

  const full = (
    <Rail
      conversations={[anchored, pageLevel, resolved, outdated]}
      chats={[chat]}
      activeConversationId={null}
      onActivate={() => {}}
      onNewPageComment={() => {}}
    />
  );

  it("groups public Conversations by attention: Open, Resolved and Outdated", () => {
    const html = render(full);

    expect(html).toContain("🔒 Private Chats (1)");
    // Anchored and page-level live Threads are merged into Open.
    expect(html).toContain("Open (2)");
    expect(html).toContain("Resolved (1)");
    expect(html).toContain("Outdated (1)");
    // Five Conversations in, five cards out — an Outdated one is moved, not dropped.
    expect(occurrences(html, 'class="thread-card')).toBe(5);
  });

  it("keeps anchored and page-level Conversations in the same Open section", () => {
    const html = render(
      <Rail
        conversations={[anchored, pageLevel]}
        chats={[]}
        activeConversationId={null}
        onActivate={() => {}}
        onNewPageComment={() => {}}
      />,
    );

    expect(html).toContain("Open (2)");
    expect(html).not.toContain("Anchored (");
    expect(html).not.toContain("Page Comments (");
    // The distinction is per card, not per section.
    expect(html).toContain("Page Comment");
    expect(html).toContain("the rendered text");
  });

  it("moves resolved Conversations out of Open so the count answers how much is open", () => {
    const html = render(
      <Rail
        conversations={[anchored, resolved]}
        chats={[]}
        activeConversationId={null}
        onActivate={() => {}}
        onNewPageComment={() => {}}
      />,
    );

    expect(html).toContain("Open (1)");
    expect(html).not.toContain("Open (2)");
    expect(html).toContain("Resolved (1)");
  });

  it("removes the Open section entirely when the only Conversation is resolved", () => {
    const html = render(
      <Rail
        conversations={[resolved]}
        chats={[]}
        activeConversationId={null}
        onActivate={() => {}}
        onNewPageComment={() => {}}
      />,
    );

    expect(html).not.toContain("Open (");
    expect(html).toContain("Resolved (1)");
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

  describe("page-level composer", () => {
    it("renders inline at the top of the rail when supplied", () => {
      const html = render(
        <Rail
          conversations={[]}
          chats={[]}
          activeConversationId={null}
          onActivate={() => {}}
          onNewPageComment={() => {}}
          onBringAgent={() => {}}
          pageLevelComposer={<div class="page-composer-slot">Composer</div>}
        />,
      );
      expect(html).toContain("rail-inline-composer");
      expect(html).toContain("page-composer-slot");
      // The "Comment on this page" button is hidden while the composer is open,
      // but the unrelated agent button stays reachable.
      expect(html).not.toContain("page-comment-btn");
      expect(html).toContain("bring-agent-btn");
    });

    it("falls back to the page-comment button when no composer is supplied", () => {
      const html = render(
        <Rail
          conversations={[]}
          chats={[]}
          activeConversationId={null}
          onActivate={() => {}}
          onNewPageComment={() => {}}
        />,
      );
      expect(html).toContain("page-comment-btn");
      expect(html).not.toContain("rail-inline-composer");
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
    // Every card carries it, the resolved one included: since issue #117 its
    // actions are folded inside a closed disclosure rather than left out of the
    // document, so they are in the markup and out of sight.
    expect(occurrences(withModeration, "thread-action-btn--delete")).toBe(5);
  });

  // ADR-0038: a consumer that cannot write yet supplies a port with no methods,
  // and the rail is a reading surface — every Conversation, no controls. This is
  // the rule the hosted viewer's server render relies on (issue #111).
  it("renders every Conversation and no controls for a port that can only read", () => {
    const html = render(
      <Rail
        conversations={[anchored, resolved, outdated]}
        chats={[]}
        activeConversationId={null}
        onActivate={() => {}}
      />,
      { displayName: null, canModerate: false },
    );

    expect(occurrences(html, 'class="thread-card')).toBe(3);
    expect(html).toContain("This claim needs a citation.");
    expect(html).not.toContain("thread-action-btn");
    expect(html).not.toContain("comment-action-btn");
    expect(html).not.toContain("reaction-chip");
    expect(html).not.toContain("page-comment-btn");
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

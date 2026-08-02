import { describe, expect, it } from "vitest";
import { Comment, Composer, ConversationCard, IdentityDisplay, Reactions } from "../src/index.js";
import {
  comment,
  conversation,
  identity,
  occurrences,
  render,
  stubPort,
} from "./helpers/fixtures.js";

describe("ConversationCard", () => {
  it("renders the anchor quote for an anchored Conversation", () => {
    const html = render(
      <ConversationCard
        conversation={conversation({ anchor: { textQuote: { exact: "a claim" } } })}
        active={false}
        onActivate={() => {}}
      />,
    );

    expect(html).toContain("“a claim”");
  });

  it("labels a Page-level Conversation instead of quoting it", () => {
    const html = render(
      <ConversationCard
        conversation={conversation({ anchor: null })}
        active={false}
        onActivate={() => {}}
      />,
    );

    expect(html).toContain(">Page comment<");
    expect(html).not.toContain("thread-anchor-label");
  });

  it('flags an Outdated Anchor while keeping the original quote (CONTEXT "Outdated")', () => {
    const html = render(
      <ConversationCard
        conversation={conversation({
          anchorStatus: "outdated",
          anchor: { textQuote: { exact: "what it used to say" } },
        })}
        active={false}
        onActivate={() => {}}
      />,
    );

    expect(html).toContain("thread-card--outdated");
    expect(html).toContain("outdated");
    expect(html).toContain("“what it used to say”");
  });

  // A Resolved Conversation collapses but is never deleted (CONTEXT "Resolved").
  describe("Resolved", () => {
    const resolved = conversation({
      resolved: true,
      resolvedBy: "Reviewer Jane",
      comments: [comment({ id: "a" }), comment({ id: "b", body: "second" })],
    });

    it("collapses to a comment count, hiding the bodies", () => {
      const html = render(
        <ConversationCard conversation={resolved} active={false} onActivate={() => {}} />,
      );

      expect(html).toContain("thread-card--resolved");
      expect(html).toContain("Resolved");
      expect(html).toContain("2 comments — show");
      expect(html).not.toContain("second");
    });

    it("singularises the collapsed count for one Comment", () => {
      const html = render(
        <ConversationCard
          conversation={conversation({ resolved: true, comments: [comment()] })}
          active={false}
          onActivate={() => {}}
        />,
      );

      expect(html).toContain("1 comment — show");
    });
  });

  it("offers Reply and Resolve, and Reopen once resolved", () => {
    const open = render(
      <ConversationCard conversation={conversation()} active={false} onActivate={() => {}} />,
    );
    expect(open).toContain(">Reply<");
    expect(open).toContain(">Resolve<");

    // Expanded via the collapsed summary in the browser; unresolved is enough to
    // pin the caption flip here.
    const reopened = render(
      <ConversationCard
        conversation={conversation({ resolved: false, resolvedBy: "Jane" })}
        active={false}
        onActivate={() => {}}
      />,
    );
    expect(reopened).toContain(">Resolve<");
  });

  // ADR-0030: an absent port method is a surface the consumer doesn't have. The
  // control is not rendered, rather than rendered and failing on click — the
  // server render supplies none of them, because nothing has been clicked yet.
  describe("capabilities the consumer doesn't have", () => {
    it("drops Resolve when the port cannot record one", () => {
      const html = render(
        <ConversationCard conversation={conversation()} active={false} onActivate={() => {}} />,
        stubPort({ setResolved: undefined }),
      );

      expect(html).not.toContain(">Resolve<");
      // Reply is unaffected — a Comment is an append, which every port can do.
      expect(html).toContain(">Reply<");
    });

    it("drops Promote when the port cannot promote, even on a promotable Chat", () => {
      const html = render(
        <ConversationCard
          conversation={conversation({ visibility: "private" })}
          active={false}
          onActivate={() => {}}
          isPrivate
          promotable
        />,
        stubPort({ promote: undefined }),
      );

      expect(html).not.toContain(">Promote<");
    });

    it("drops Delete for a moderator whose port cannot delete a Conversation", () => {
      const html = render(
        <ConversationCard conversation={conversation()} active={false} onActivate={() => {}} />,
        stubPort({ canModerate: true, deleteConversation: undefined }),
      );

      expect(html).not.toContain("thread-action-btn--delete");
    });
  });

  it("names the resolver only while the Conversation is resolved", () => {
    const html = render(
      <ConversationCard
        conversation={conversation({ resolvedBy: "Reviewer Jane", resolved: false })}
        active={false}
        onActivate={() => {}}
      />,
    );

    expect(html).not.toContain("Resolved by");
  });
});

describe("Comment", () => {
  it("renders a tombstone with no body, reactions or actions", () => {
    const html = render(
      <Comment comment={comment({ deleted: true, body: "", mine: true })} />,
      stubPort(),
    );

    expect(html).toContain("comment deleted");
    expect(html).not.toContain("reactions");
    expect(html).not.toContain("comment-actions");
  });

  it("marks an edited Comment", () => {
    const html = render(<Comment comment={comment({ editedAt: "2026-07-29T13:00:00.000Z" })} />);
    expect(html).toContain("(edited)");
  });

  it("offers edit and delete only on the reader's own Comment", () => {
    expect(render(<Comment comment={comment({ mine: false })} />)).not.toContain("comment-actions");
    expect(render(<Comment comment={comment({ mine: true })} />)).toContain("comment-actions");
  });

  it("drops edit and delete on the reader's own Comment when the port has neither", () => {
    const html = render(
      <Comment comment={comment({ mine: true })} />,
      stubPort({ editComment: undefined, deleteComment: undefined }),
    );

    expect(html).not.toContain("comment-actions");
  });

  // CONTEXT "Owner": moderation is removing someone's words, never rewriting
  // them — so the Owner gets Delete on a Comment that is not theirs, and no Edit.
  it("offers the Owner delete on someone else's Comment, but never edit", () => {
    const html = render(
      <Comment comment={comment({ mine: false })} />,
      stubPort({ canModerate: true }),
    );

    expect(html).toContain("comment-actions");
    expect(html).toContain(">Delete<");
    expect(html).not.toContain(">Edit<");
    // Labelled as moderation, so a reader can tell which of the two they are doing.
    expect(html).toContain("Owner moderation");
  });

  it("gives the Owner no moderation delete when the port cannot delete a Comment", () => {
    const html = render(
      <Comment comment={comment({ mine: false })} />,
      stubPort({ canModerate: true, deleteComment: undefined }),
    );

    expect(html).not.toContain("comment-actions");
  });

  it("leaves the Owner's own Comment with the plain author affordances", () => {
    const html = render(
      <Comment comment={comment({ mine: true })} />,
      stubPort({ canModerate: true }),
    );

    expect(html).toContain(">Edit<");
    expect(html).not.toContain("Owner moderation");
  });
});

describe("Reactions", () => {
  it("offers the whole palette when nothing has been reacted with yet", () => {
    const html = render(<Reactions commentId="c1" reactions={[]} />);

    expect(occurrences(html, "<button")).toBe(6);
    expect(html).not.toContain("reaction-chip__count");
  });

  // Once there are counts the rail shows only what people actually used, so the
  // card stays readable.
  it("shows only reacted emoji, with counts, once there are any", () => {
    const html = render(
      <Reactions
        commentId="c1"
        reactions={[
          { emoji: "👍", count: 2, mine: true },
          { emoji: "👀", count: 1, mine: false },
        ]}
      />,
    );

    expect(occurrences(html, "<button")).toBe(2);
    expect(occurrences(html, "reaction-chip__count")).toBe(2);
    expect(html).toContain("reaction-chip--mine");
    expect(html).toContain("👍 2 (you reacted)");
  });

  it("offers no palette when the port cannot record a Reaction", () => {
    const html = render(
      <Reactions commentId="c1" reactions={[]} />,
      stubPort({ toggleReaction: undefined }),
    );

    expect(html).toBe("");
  });

  // Tallies already on a Comment are part of what it says, so they still render
  // — just not as something to click.
  it("still shows existing tallies read-only when the port cannot react", () => {
    const html = render(
      <Reactions commentId="c1" reactions={[{ emoji: "👍", count: 3, mine: false }]} />,
      stubPort({ toggleReaction: undefined }),
    );

    expect(html).toContain("reaction-chip--static");
    expect(html).toContain("3");
    expect(html).not.toContain("<button");
  });
});

describe("Composer", () => {
  it("prompts for a display name when the reader hasn't given one", () => {
    const html = render(<Composer needsName onSubmit={() => {}} />);
    expect(html).toContain("composer-name-row");
  });

  it("skips the name row once there is one", () => {
    const html = render(<Composer needsName={false} currentName="Jane" onSubmit={() => {}} />);
    expect(html).not.toContain("composer-name-row");
  });

  it("uses the consumer's captions and disables submit until there is a body", () => {
    const html = render(
      <Composer needsName={false} submitLabel="Ask" label="Ask your agent" onSubmit={() => {}} />,
    );

    expect(html).toContain("Ask your agent");
    expect(html).toContain(">Ask<");
    expect(html).toContain("disabled");
  });
});

describe("IdentityDisplay", () => {
  it('badges an agent so human-vs-agent is never ambiguous (CONTEXT "Identity")', () => {
    const html = render(<IdentityDisplay identity={identity({ kind: "agent" })} />);
    expect(html).toContain("identity-badge--agent");
  });

  it("marks the Owner tier", () => {
    const html = render(<IdentityDisplay identity={identity({ tier: "owner" })} />);
    expect(html).toContain("identity-tier--owner");
  });

  it("leaves a plain human Viewer unadorned", () => {
    const html = render(<IdentityDisplay identity={identity()} />);
    expect(html).not.toContain("identity-badge--agent");
    expect(html).not.toContain("identity-tier--owner");
  });
});

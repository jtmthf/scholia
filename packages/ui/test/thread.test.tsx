import { describe, expect, it } from "vitest";
import { Comment, Composer, IdentityDisplay, Reactions, Thread } from "../src/index.js";
import {
  comment,
  conversation,
  identity,
  occurrences,
  render,
  stubPort,
} from "./helpers/fixtures.js";

describe("Thread", () => {
  it("renders the anchor quote for an anchored Conversation", () => {
    const html = render(
      <Thread
        conversation={conversation({ anchor: { textQuote: { exact: "a claim" } } })}
        active={false}
        onActivate={() => {}}
      />,
    );

    expect(html).toContain("“a claim”");
  });

  it("labels a Page-level Conversation instead of quoting it", () => {
    const html = render(
      <Thread conversation={conversation({ anchor: null })} active={false} onActivate={() => {}} />,
    );

    expect(html).toContain(">Page comment<");
    expect(html).not.toContain("thread-anchor-label");
  });

  it('flags an Outdated Anchor while keeping the original quote (CONTEXT "Outdated")', () => {
    const html = render(
      <Thread
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
      const html = render(<Thread conversation={resolved} active={false} onActivate={() => {}} />);

      expect(html).toContain("thread-card--resolved");
      expect(html).toContain("Resolved");
      expect(html).toContain("2 comments — show");
      expect(html).not.toContain("second");
    });

    it("singularises the collapsed count for one Comment", () => {
      const html = render(
        <Thread
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
      <Thread conversation={conversation()} active={false} onActivate={() => {}} />,
    );
    expect(open).toContain(">Reply<");
    expect(open).toContain(">Resolve<");

    // Expanded via the collapsed summary in the browser; unresolved is enough to
    // pin the caption flip here.
    const reopened = render(
      <Thread
        conversation={conversation({ resolved: false, resolvedBy: "Jane" })}
        active={false}
        onActivate={() => {}}
      />,
    );
    expect(reopened).toContain(">Resolve<");
  });

  it("names the resolver only while the Conversation is resolved", () => {
    const html = render(
      <Thread
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

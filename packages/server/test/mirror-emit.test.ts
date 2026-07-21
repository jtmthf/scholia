import { describe, test, expect } from "vitest";
import { emitCommentCreated, emitResolve, emitPromotion, type EmitDeps } from "../src/mirror/emit.js";

const bondGithub: EmitDeps["mirrorBinding"] = { provider: "github", repo: "o/r", prNumber: 1 };
const bondOther: EmitDeps["mirrorBinding"] = { provider: "gitlab", repo: "o/r", prNumber: 1 };

function recorder(): { bus: { emit: (e: unknown) => void }; events: unknown[] } {
  const events: unknown[] = [];
  return { bus: { emit: (e) => events.push(e) }, events };
}

describe("mirror emit skip logic", () => {
  test("private visibility never emits a comment_created", () => {
    const r = recorder();
    emitCommentCreated(
      { mirrorBinding: bondGithub, siteId: "s", siteState: "open", mirrorBus: r.bus },
      mkComment({ visibility: "private" }),
    );
    expect(r.events).toHaveLength(0);
  });

  test("frozen site state skips new public comments", () => {
    const r = recorder();
    emitCommentCreated(
      { mirrorBinding: bondGithub, siteId: "s", siteState: "frozen", mirrorBus: r.bus },
      mkComment({ visibility: "public" }),
    );
    expect(r.events).toHaveLength(0);
  });

  test("non-github binding is not mirrored", () => {
    const r = recorder();
    emitCommentCreated(
      { mirrorBinding: bondOther, siteId: "s", siteState: "open", mirrorBus: r.bus },
      mkComment({ visibility: "public" }),
    );
    expect(r.events).toHaveLength(0);
  });

  test("null binding is a no-op (non-PR-backed Site)", () => {
    const r = recorder();
    emitCommentCreated(
      { mirrorBinding: null, siteId: "s", siteState: "open", mirrorBus: r.bus },
      mkComment({ visibility: "public" }),
    );
    expect(r.events).toHaveLength(0);
  });

  test("public comment on an open PR-backed Site emits one event", () => {
    const r = recorder();
    emitCommentCreated(
      { mirrorBinding: bondGithub, siteId: "s", siteState: "open", mirrorBus: r.bus },
      mkComment({ visibility: "public" }),
    );
    expect(r.events).toHaveLength(1);
    expect((r.events[0] as { type: string }).type).toBe("comment_created");
  });

  test("resolve emits only for public github threads (not private)", () => {
    const rPub = recorder();
    emitResolve(
      { mirrorBinding: bondGithub, siteId: "s", siteState: "open", mirrorBus: rPub.bus },
      { conversationId: "c", pagePath: "doc.md", createdVersionId: "v", resolved: true, resolvedBy: "x", visibility: "public" },
    );
    expect(rPub.events).toHaveLength(1);

    const rPriv = recorder();
    emitResolve(
      { mirrorBinding: bondGithub, siteId: "s", siteState: "open", mirrorBus: rPriv.bus },
      { conversationId: "c", pagePath: "doc.md", createdVersionId: "v", resolved: true, resolvedBy: "x", visibility: "private" },
    );
    expect(rPriv.events).toHaveLength(0);
  });

  test("promotion emits one event with all visible comments", () => {
    const r = recorder();
    emitPromotion(
      { mirrorBinding: bondGithub, siteId: "s", siteState: "open", mirrorBus: r.bus },
      {
        conversationId: "c",
        pagePath: "doc.md",
        createdVersionId: "v",
        visibility: "public",
        comments: [
          { commentId: "c1", author: mkId(), body: "a", anchor: null },
          { commentId: "c2", author: mkId(), body: "b", anchor: null },
        ],
      },
    );
    expect(r.events).toHaveLength(1);
    expect((r.events[0] as { type: string }).type).toBe("promotion");
  });

  test("promotion with no now-public comments is a no-op", () => {
    const r = recorder();
    emitPromotion(
      { mirrorBinding: bondGithub, siteId: "s", siteState: "open", mirrorBus: r.bus },
      { conversationId: "c", pagePath: "doc.md", createdVersionId: "v", visibility: "public", comments: [] },
    );
    expect(r.events).toHaveLength(0);
  });
});

function mkId() {
  return { name: "Jane", kind: "human" as const, tier: "viewer" as const, source: "native" as const };
}

function mkComment(over: { visibility: "public" | "private" }) {
  return {
    conversationId: "c",
    commentId: "cm",
    pagePath: "doc.md",
    createdVersionId: "v",
    author: mkId(),
    body: "hello",
    anchor: null,
    visibility: over.visibility,
  };
}